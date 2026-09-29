import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { registrationService } from '../services/registrationService.js';
import { useToast } from '../context/ToastContext.jsx';
import { parseTicketInput } from '../utils/ticket.js';

/**
 * Door check-in.
 *
 * Two ways in:
 *  1. the camera opens this page with ?token=...&event=... straight from a
 *     scanned QR code, which auto-submits;
 *  2. the organiser types or pastes a ticket token, or a whole ticket link,
 *     straight from the attendee list.
 */
export default function CheckIn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const inputRef = useRef(null);

  const [token, setToken] = useState('');
  const [result, setResult] = useState(null);

  // A scanned QR lands here as ?token=...&event=..., so read the token from
  // the URL rather than copying it into state.
  const tokenFromUrl = searchParams.get('token') ?? '';
  const { eventId } = parseTicketInput(tokenFromUrl);
  const effectiveToken = token || tokenFromUrl;

  const scan = useMutation({
    mutationFn: (value) => registrationService.checkIn(value),
    onSuccess: (response) => {
      setResult({ ok: true, ...response.data });
      toast.success(response.data.alreadyCheckedIn ? 'Already checked in.' : 'Attendee checked in.');
    },
    onError: (err) => {
      setResult({ ok: false, message: err.message, code: err.code });
    },
  });

  // Redeem the token from the deep link exactly once per token value, so a
  // re-render can never double-check somebody in.
  useEffect(() => {
    const { token: fromUrl } = parseTicketInput(tokenFromUrl);
    if (!fromUrl) return;
    scan.mutate({ token: fromUrl, eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenFromUrl, eventId]);

  const submit = (event) => {
    event.preventDefault();
    // The organiser may paste either a bare token or a whole ticket link.
    const { token: value, eventId: parsedEvent } = parseTicketInput(effectiveToken);
    if (!value) return;
    scan.mutate({ token: value, eventId: eventId || parsedEvent });
  };

  const reset = () => {
    setResult(null);
    setToken('');
    setSearchParams(eventId ? { event: eventId } : {}, { replace: true });
    inputRef.current?.focus();
  };

  return (
    <div className="container stack stack-6" style={{ maxWidth: 640 }}>
      <header className="stack stack-2">
        <h1>Check-in scanner</h1>
        <p className="muted">
          Scan an attendee QR code with the device camera, or type the ticket number below. Opening
          this page from a camera works too - the token is read from the link.
        </p>
      </header>

      <form className="panel stack stack-4" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="token">
            QR token or ticket reference
          </label>
          <input
            id="token"
            ref={inputRef}
            className="input"
            value={token}
            readOnly={Boolean(tokenFromUrl) && !token}
            autoComplete="off"
            spellCheck="false"
            placeholder="Paste the QR link or token"
            onChange={(e) => setToken(e.target.value)}
          />
          <span className="hint">
            {eventId
              ? 'Validating against the event selected in the URL.'
              : 'Scanning a code from a different event will be rejected.'}
          </span>
        </div>

        <div className="row wrap row-2">
          <button type="submit" className="btn btn-lg" disabled={scan.isPending || !effectiveToken.trim()}>
            {scan.isPending ? 'Checking' : 'Check in'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={reset} disabled={scan.isPending}>
            Clear
          </button>
        </div>
      </form>

      {result && <ScanResult result={result} onNext={reset} />}

      <p className="tiny muted">
        Looking for your own tickets instead? <Link to="/tickets">Go to my tickets</Link>
      </p>
    </div>
  );
}

function ScanResult({ result, onNext }) {
  if (result.ok) {
    return (
      <div className="panel stack stack-3" style={{ borderColor: 'var(--success-600)' }}>
        <div className="row row-3">
          <span style={{ fontSize: '2rem' }} aria-hidden="true">
            ✓
          </span>
          <div>
            <h2 style={{ margin: 0 }}>Checked in</h2>
            <p className="muted" style={{ margin: 0 }}>
              {result.attendeeName ?? 'Attendee'}
              {result.ticketNumber ? ` - ticket ${result.ticketNumber}` : ''}
            </p>
          </div>
        </div>
        {result.alreadyCheckedIn && (
          <div className="alert alert-warning">This ticket was already scanned earlier.</div>
        )}
        {result.stillWaitlisted > 0 && (
          <p className="small muted">{result.stillWaitlisted} still on the waitlist.</p>
        )}
        <button type="button" className="btn" onClick={onNext}>
          Scan the next attendee
        </button>
      </div>
    );
  }

  return (
    <div className="panel stack stack-3" style={{ borderColor: 'var(--danger-600)' }}>
      <div className="row row-3">
        <span style={{ fontSize: '2rem' }} aria-hidden="true">
          ✕
        </span>
        <div>
          <h2 style={{ margin: 0 }}>Not accepted</h2>
          <p className="muted" style={{ margin: 0 }}>
            {result.message}
          </p>
        </div>
      </div>
      <button type="button" className="btn" onClick={onNext}>
        Try another code
      </button>
    </div>
  );
}
