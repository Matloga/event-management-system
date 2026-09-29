/* =====================================================================
   Event Management System - stored procedures
   Encapsulates the transactional, race-sensitive logic (seat limits,
   duplicate prevention, waitlist promotion, check-in) so it cannot be
   bypassed by application code.
   Requires 001_schema.sql to have been run first.
   ===================================================================== */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------
   1. sp_register_for_event
   Replaces the whole INSERT path for registrations. Everything runs
   under UPDLOCK + HOLDLOCK on the event row so two concurrent
   registrations can never both read "seats remaining" and both win.

   Returns a single-row result set:
     result_code     'confirmed' | 'waitlisted' | 'duplicate' | 'full'
                     | 'not_found' | 'unpublished' | 'not_allowed'
     registration_id UNIQUEIDENTIFIER  (NULL unless confirmed/waitlisted)
     ticket_number   VARCHAR(24)        (NULL unless confirmed/waitlisted)
     qr_token        VARCHAR(64)        (NULL unless confirmed/waitlisted)
     event_title / event_date / venue / city
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_register_for_event
    @EventId   UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,
    @AllowFull BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @outcome       VARCHAR(20)      = 'full';
    DECLARE @newStatus     VARCHAR(20)      = NULL;
    DECLARE @title         NVARCHAR(200)    = NULL;
    DECLARE @eventDate     DATE             = NULL;
    DECLARE @venue         NVARCHAR(200)    = NULL;
    DECLARE @city          NVARCHAR(100)    = NULL;
    DECLARE @capacity      INT              = 0;
    DECLARE @confirmedCnt  INT              = 0;
    DECLARE @regId         UNIQUEIDENTIFIER = NULL;
    DECLARE @ticketNumber  VARCHAR(24)      = NULL;
    DECLARE @qrToken       VARCHAR(64)      = NULL;

    /* Serialise all registration attempts for this event against each other. */
    BEGIN TRANSACTION;

    SELECT
        @title     = e.title,
        @eventDate = e.event_date,
        @venue     = e.venue,
        @city      = e.city,
        @capacity  = e.capacity
    FROM dbo.events e WITH (UPDLOCK, HOLDLOCK)
    WHERE e.id = @EventId
      AND e.is_published = 1;

    IF @@ROWCOUNT = 0
    BEGIN
        SET @outcome = 'not_found';
        COMMIT TRANSACTION;
        SELECT @outcome AS result_code, @title AS event_title, @eventDate AS event_date,
               @venue AS venue, @city AS city,
               CAST(NULL AS UNIQUEIDENTIFIER) AS registration_id,
               CAST(NULL AS VARCHAR(24)) AS ticket_number,
               CAST(NULL AS VARCHAR(64)) AS qr_token;
        RETURN;
    END;

    /* Already holding a seat or a waitlist place? */
    IF EXISTS (
        SELECT 1
        FROM dbo.registrations
        WHERE event_id = @EventId
          AND user_id  = @UserId
          AND status IN ('confirmed', 'waitlisted')
    )
    BEGIN
        SET @outcome = 'duplicate';
        COMMIT TRANSACTION;
        SELECT @outcome AS result_code, @title AS event_title, @eventDate AS event_date,
               @venue AS venue, @city AS city,
               CAST(NULL AS UNIQUEIDENTIFIER) AS registration_id,
               CAST(NULL AS VARCHAR(24)) AS ticket_number,
               CAST(NULL AS VARCHAR(64)) AS qr_token;
        RETURN;
    END;

    SELECT @confirmedCnt = COUNT_BIG(*)
    FROM dbo.registrations
    WHERE event_id = @EventId
      AND status = 'confirmed';

    IF @confirmedCnt < @capacity
        SET @newStatus = 'confirmed';
    ELSE IF @AllowFull = 1
        SET @newStatus = 'waitlisted';
    ELSE
        SET @outcome = 'full';

    IF @newStatus IS NOT NULL
    BEGIN
        SET @regId   = NEWID();
        SET @qrToken = REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')
                     + REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '');
        SET @ticketNumber = 'EVT-'
                          + UPPER(SUBSTRING(REPLACE(CONVERT(VARCHAR(36), @regId), '-', ''), 1, 6))
                          + '-' + RIGHT('0000' + CONVERT(VARCHAR(10), (ABS(CHECKSUM(@regId)) % 10000)), 4);

        /* Safe: any pre-existing row for this pair has status 'cancelled',
           which the filtered unique index UX_registrations_active ignores. */
        INSERT INTO dbo.registrations (id, event_id, user_id, status, ticket_number, qr_token)
        VALUES (@regId, @EventId, @UserId, @newStatus, @ticketNumber, @qrToken);

        SET @outcome = @newStatus;
    END;

    COMMIT TRANSACTION;

    SELECT @outcome AS result_code, @title AS event_title, @eventDate AS event_date,
           @venue AS venue, @city AS city,
           @regId AS registration_id, @ticketNumber AS ticket_number, @qrToken AS qr_token;
END
GO

/* ---------------------------------------------------------------------
   2. sp_cancel_registration
   Cancels @UserId's confirmed seat and promotes the longest-waiting
   waitlisted attendee into the freed seat, in the same transaction.

   @ActorId is the authenticated caller. Authorised when the caller is
   the attendee themselves, the event's organizer, or an admin.

   Returns: result_code ('cancelled' | 'not_found' | 'not_allowed'),
            promoted_ticket (ticket number of the promoted attendee)
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_cancel_registration
    @EventId  UNIQUEIDENTIFIER,
    @UserId   UNIQUEIDENTIFIER,
    @ActorId  UNIQUEIDENTIFIER,
    @IsAdmin  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @outcome      VARCHAR(20)      = 'not_found';
    DECLARE @regId        UNIQUEIDENTIFIER = NULL;
    DECLARE @organizerId  UNIQUEIDENTIFIER = NULL;
    DECLARE @promoted     VARCHAR(24)      = NULL;
    DECLARE @capacity     INT              = 0;
    DECLARE @confirmedCnt INT              = 0;

    BEGIN TRANSACTION;

    SELECT @organizerId = e.organizer_id, @capacity = e.capacity
    FROM dbo.events e WITH (UPDLOCK, HOLDLOCK)
    WHERE e.id = @EventId;

    IF @organizerId IS NOT NULL AND @ActorId <> @UserId AND @IsAdmin = 0 AND @ActorId <> @organizerId
    BEGIN
        SET @outcome = 'not_allowed';
        COMMIT TRANSACTION;
        SELECT @outcome AS result_code, CAST(NULL AS VARCHAR(24)) AS promoted_ticket;
        RETURN;
    END;

    SELECT @regId = r.id
    FROM dbo.registrations r WITH (UPDLOCK, HOLDLOCK)
    WHERE r.event_id = @EventId
      AND r.user_id  = @UserId
      AND r.status   = 'confirmed';

    IF @regId IS NOT NULL
    BEGIN
        UPDATE dbo.registrations
        SET status = 'cancelled', cancelled_at = SYSUTCDATETIME()
        WHERE id = @regId;

        SELECT @confirmedCnt = COUNT_BIG(*)
        FROM dbo.registrations
        WHERE event_id = @EventId AND status = 'confirmed';

        IF @confirmedCnt < @capacity
        BEGIN
            SELECT TOP 1 @regId = id, @promoted = ticket_number
            FROM dbo.registrations WITH (UPDLOCK, HOLDLOCK)
            WHERE event_id = @EventId AND status = 'waitlisted'
            ORDER BY registered_at ASC, id ASC;

            IF @regId IS NOT NULL
            BEGIN
                UPDATE dbo.registrations
                SET status = 'confirmed'
                WHERE id = @regId;
            END;
        END;

        SET @outcome = 'cancelled';
    END;

    COMMIT TRANSACTION;

    SELECT @outcome AS result_code, @promoted AS promoted_ticket;
END
GO

/* ---------------------------------------------------------------------
   3. sp_check_in_ticket
   Validates a scanned QR token and marks the attendee as checked in.
   Idempotent: scanning twice reports 'already'.
   The read takes an update lock, so two scanners racing on the same token
   serialise and only one of them sees checked_in_at IS NULL.

   @EventId must be the event the caller was already authorised for, never one
   the client claimed. The token is re-checked against it inside the same
   transaction that performs the UPDATE, so an authorisation decision made by
   the API a moment earlier cannot drift away from the row being written.

   Returns: result_code, attendee_name, ticket_number, event_id, waitlisted
     'ok' | 'already' | 'invalid' | 'wrong_event' | 'cancelled' | 'waitlisted'
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_check_in_ticket
    @QrToken VARCHAR(64),
    @EventId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @outcome  VARCHAR(20)      = 'invalid';
    DECLARE @name     NVARCHAR(120)    = NULL;
    DECLARE @ticket   VARCHAR(24)      = NULL;
    DECLARE @status   VARCHAR(20)      = NULL;
    DECLARE @checked  DATETIME2(3)     = NULL;
    DECLARE @regEvent UNIQUEIDENTIFIER = NULL;
    DECLARE @queued   INT              = 0;

    BEGIN TRANSACTION;

    SELECT
        @regEvent = r.event_id,
        @status   = r.status,
        @ticket   = r.ticket_number,
        @name     = u.name,
        @checked  = r.checked_in_at
    FROM dbo.registrations r WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN dbo.users u ON u.id = r.user_id
    WHERE r.qr_token = @QrToken;

    IF @@ROWCOUNT = 0
    BEGIN
        COMMIT TRANSACTION;
        SELECT @outcome AS result_code, @name AS attendee_name, @ticket AS ticket_number,
               @regEvent AS event_id, @queued AS waitlisted;
        RETURN;
    END;

    SELECT @queued = COUNT(*)
    FROM dbo.registrations WITH (UPDLOCK, HOLDLOCK)
    WHERE event_id = @regEvent AND status = 'waitlisted';

    IF @status = 'cancelled'
    BEGIN
        COMMIT TRANSACTION;
        SELECT 'cancelled' AS result_code, @name AS attendee_name, @ticket AS ticket_number,
               @regEvent AS event_id, @queued AS waitlisted;
        RETURN;
    END;

    IF @status = 'waitlisted'
    BEGIN
        COMMIT TRANSACTION;
        SELECT 'waitlisted' AS result_code, @name AS attendee_name, @ticket AS ticket_number,
               @regEvent AS event_id, @queued AS waitlisted;
        RETURN;
    END;

    IF @EventId IS NOT NULL AND @regEvent <> @EventId
    BEGIN
        COMMIT TRANSACTION;
        SELECT 'wrong_event' AS result_code, @name AS attendee_name, @ticket AS ticket_number,
               @regEvent AS event_id, @queued AS waitlisted;
        RETURN;
    END;

    IF @checked IS NOT NULL
    BEGIN
        COMMIT TRANSACTION;
        SELECT 'already' AS result_code, @name AS attendee_name, @ticket AS ticket_number,
               @regEvent AS event_id, @queued AS waitlisted;
        RETURN;
    END;

    UPDATE dbo.registrations
    SET checked_in_at = SYSUTCDATETIME()
    WHERE qr_token = @QrToken;

    COMMIT TRANSACTION;

    SELECT 'ok' AS result_code, @name AS attendee_name, @ticket AS ticket_number,
           @regEvent AS event_id, @queued AS waitlisted;
END
GO

PRINT 'Stored procedures created.';
GO
