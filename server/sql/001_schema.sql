/* =====================================================================
   Event Management System - SQL Server schema
   Target: SQL Server 2019+ / Azure SQL
   Run against an empty database.
   ===================================================================== */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------
   users
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id            UNIQUEIDENTIFIER  NOT NULL CONSTRAINT PK_users PRIMARY KEY,
        name          NVARCHAR(120)     NOT NULL,
        email         NVARCHAR(255)     NOT NULL,
        password_hash NVARCHAR(255)     NOT NULL,
        role          VARCHAR(20)       NOT NULL CONSTRAINT DF_users_role DEFAULT 'attendee',
        organisation  NVARCHAR(120)     NULL,
        phone         NVARCHAR(32)      NULL,
        bio           NVARCHAR(500)     NULL,
        created_at    DATETIME2(3)      NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(3)      NOT NULL CONSTRAINT DF_users_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_users_role CHECK (role IN ('attendee', 'organizer', 'admin'))
    );

    /* Case-insensitive uniqueness: prevents Foo@x.com and foo@x.com coexisting */
    CREATE UNIQUE INDEX UX_users_email ON dbo.users (email);
END
GO

/* ---------------------------------------------------------------------
   categories
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.categories', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.categories (
        id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_categories PRIMARY KEY,
        name        NVARCHAR(60)    NOT NULL,
        slug        VARCHAR(60)     NOT NULL,
        description NVARCHAR(255)   NULL,
        accent      VARCHAR(24)     NOT NULL CONSTRAINT DF_categories_accent DEFAULT '#4f46e5',
        CONSTRAINT UX_categories_slug UNIQUE (slug)
    );
END
GO

/* ---------------------------------------------------------------------
   events
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.events (
        id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_events PRIMARY KEY,
        title        NVARCHAR(200)    NOT NULL,
        description  NVARCHAR(MAX)    NOT NULL,
        category_id  UNIQUEIDENTIFIER NOT NULL,
        organizer_id UNIQUEIDENTIFIER NOT NULL,
        event_date   DATE             NOT NULL,
        start_time   TIME(0)          NOT NULL,
        end_time     TIME(0)          NULL,
        venue        NVARCHAR(200)    NOT NULL,
        address      NVARCHAR(255)    NULL,
        city         NVARCHAR(100)    NOT NULL,
        country      NVARCHAR(100)    NOT NULL CONSTRAINT DF_events_country DEFAULT 'South Africa',
        latitude     DECIMAL(9,6)     NULL,
        longitude    DECIMAL(9,6)     NULL,
        capacity     INT              NOT NULL,
        /* price is always >= 0; 0 means free */
        price        DECIMAL(10,2)    NOT NULL CONSTRAINT DF_events_price DEFAULT 0,
        is_featured  BIT              NOT NULL CONSTRAINT DF_events_featured DEFAULT 0,
        is_published BIT              NOT NULL CONSTRAINT DF_events_published DEFAULT 0,
        image_url    NVARCHAR(500)    NULL,
        created_at   DATETIME2(3)     NOT NULL CONSTRAINT DF_events_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2(3)     NOT NULL CONSTRAINT DF_events_updated DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_events_category  FOREIGN KEY (category_id)  REFERENCES dbo.categories (id),
        CONSTRAINT FK_events_organizer FOREIGN KEY (organizer_id) REFERENCES dbo.users (id),
        CONSTRAINT CK_events_capacity  CHECK (capacity > 0),
        CONSTRAINT CK_events_price     CHECK (price >= 0),
        CONSTRAINT CK_events_times     CHECK (end_time IS NULL OR end_time > start_time)
    );

    CREATE INDEX IX_events_date       ON dbo.events (event_date);
    CREATE INDEX IX_events_published  ON dbo.events (is_published, event_date);
    CREATE INDEX IX_events_category   ON dbo.events (category_id);
    CREATE INDEX IX_events_organizer  ON dbo.events (organizer_id);
END
GO

/* ---------------------------------------------------------------------
   registrations
   status: 'confirmed' | 'cancelled' | 'waitlisted'
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.registrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.registrations (
        id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_registrations PRIMARY KEY,
        event_id       UNIQUEIDENTIFIER NOT NULL,
        user_id        UNIQUEIDENTIFIER NOT NULL,
        status         VARCHAR(20)      NOT NULL CONSTRAINT DF_registrations_status DEFAULT 'confirmed',
        ticket_number  VARCHAR(24)      NOT NULL,
        /* opaque random token encoded in the QR code; never expose the raw id */
        qr_token       VARCHAR(64)      NOT NULL,
        checked_in_at  DATETIME2(3)     NULL,
        registered_at  DATETIME2(3)     NOT NULL CONSTRAINT DF_registrations_registered DEFAULT SYSUTCDATETIME(),
        cancelled_at   DATETIME2(3)     NULL,

        CONSTRAINT FK_registrations_event FOREIGN KEY (event_id) REFERENCES dbo.events (id) ON DELETE CASCADE,
        CONSTRAINT FK_registrations_user  FOREIGN KEY (user_id)  REFERENCES dbo.users  (id) ON DELETE CASCADE,
        CONSTRAINT CK_registrations_status CHECK (status IN ('confirmed', 'cancelled', 'waitlisted')),
        CONSTRAINT UX_registrations_ticket UNIQUE (ticket_number),
        CONSTRAINT UX_registrations_token  UNIQUE (qr_token)
    );

    /* Challenge 1 - prevent duplicate registrations.
       Filtered index means a cancelled row does NOT block re-registering. */
    CREATE UNIQUE INDEX UX_registrations_active
        ON dbo.registrations (event_id, user_id)
        WHERE status IN ('confirmed', 'waitlisted');

    CREATE INDEX IX_registrations_event ON dbo.registrations (event_id, status);
    CREATE INDEX IX_registrations_user  ON dbo.registrations (user_id, status);
END
GO

/* ---------------------------------------------------------------------
   reviews  (event ratings - bonus)
   --------------------------------------------------------------------- */
IF OBJECT_ID('dbo.reviews', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.reviews (
        id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_reviews PRIMARY KEY,
        event_id   UNIQUEIDENTIFIER NOT NULL,
        user_id    UNIQUEIDENTIFIER NOT NULL,
        rating     TINYINT          NOT NULL,
        comment    NVARCHAR(1000)   NULL,
        created_at DATETIME2(3)     NOT NULL CONSTRAINT DF_reviews_created DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_reviews_event FOREIGN KEY (event_id) REFERENCES dbo.events (id) ON DELETE CASCADE,
        CONSTRAINT FK_reviews_user  FOREIGN KEY (user_id)  REFERENCES dbo.users  (id) ON DELETE CASCADE,
        CONSTRAINT CK_reviews_rating CHECK (rating BETWEEN 1 AND 5)
    );

    /* one review per user per event */
    CREATE UNIQUE INDEX UX_reviews_user_event ON dbo.reviews (event_id, user_id);
END
GO

PRINT 'Schema created.';
GO
