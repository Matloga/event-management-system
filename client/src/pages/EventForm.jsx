import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { eventService } from '../services/eventService.js';
import { useCategories, useEventDetail } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner } from '../components/Feedback.jsx';

const BLANK = {
  title: '',
  description: '',
  categoryId: '',
  date: '',
  startTime: '18:00',
  endTime: '',
  venue: '',
  address: '',
  city: '',
  country: 'South Africa',
  capacity: '50',
  price: '0',
  imageUrl: '',
  latitude: '',
  longitude: '',
  isPublished: true,
};

/** Map a stored event onto the form's string-valued shape. */
function toFormState(event) {
  if (!event) return BLANK;
  return {
    title: event.title ?? '',
    description: event.description ?? '',
    categoryId: event.category?.id ?? '',
    date: event.date ?? '',
    startTime: event.startTime ?? '',
    endTime: event.endTime ?? '',
    venue: event.venue ?? '',
    address: event.address ?? '',
    city: event.city ?? '',
    country: event.country ?? 'South Africa',
    capacity: String(event.capacity ?? ''),
    price: String(event.price ?? '0'),
    imageUrl: event.imageUrl ?? '',
    latitude: event.location?.latitude != null ? String(event.location.latitude) : '',
    longitude: event.location?.longitude != null ? String(event.location.longitude) : '',
    isPublished: event.isPublished,
  };
}

/**
 * Create and edit share this form: the payload shape is identical, and the
 * only differences are the submit label and which fields are pre-filled.
 */
export function CreateEvent() {
  const { isOrganizer } = useAuth();

  if (!isOrganizer) {
    return (
      <div className="container">
        <div className="alert alert-info">
          Only organisers can publish events.{' '}
          <Link to="/dashboard">Go to your dashboard</Link> to request organiser access.
        </div>
      </div>
    );
  }

  return <EventForm mode="create" />;
}

export function EditEvent() {
  const { id } = useParams();
  const { data, isPending, isError, error } = useEventDetail(id);

  if (isPending) return <Spinner label="Loading event" />;
  if (isError) return <div className="container"><div className="alert alert-error">{error.message}</div></div>;

  if (!data.event.canManage) {
    return (
      <div className="container">
        <div className="alert alert-error">You can only edit events that you created.</div>
      </div>
    );
  }

  // key: the form is only mounted once the event has loaded, so it can seed
  // its state on first render instead of syncing it in an effect.
  return <EventForm key={data.event.id} mode="edit" event={data.event} />;
}

function EventForm({ mode, event }) {
  const isEdit = mode === 'edit';
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: categories } = useCategories();

  const [form, setForm] = useState(() => toFormState(event));
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const mutation = useMutation({
    mutationFn: (payload) => (isEdit ? eventService.update(event.id, payload) : eventService.create(payload)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(isEdit ? 'Event updated.' : 'Event created.');
      navigate(`/events/${result.data.event.id}`);
    },
    onError: (err) => {
      setError(err.message);
      if (err.fieldErrors) setFieldErrors(err.fieldErrors);
    },
  });

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = (event) => {
    event.preventDefault();
    setError('');

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId,
      date: form.date,
      startTime: form.startTime,
      venue: form.venue.trim(),
      city: form.city.trim(),
      country: form.country.trim(),
      capacity: form.capacity,
      price: form.price,
    };

    if (form.endTime) payload.endTime = form.endTime;
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.imageUrl.trim()) payload.imageUrl = form.imageUrl.trim();
    if (form.latitude.trim() && form.longitude.trim()) {
      payload.latitude = form.latitude;
      payload.longitude = form.longitude;
    }
    if (!isEdit) payload.isPublished = form.isPublished;

    mutation.mutate(payload);
  };

  const field = (key) => ({
    value: form[key],
    onChange: set(key),
    'aria-invalid': Boolean(fieldErrors[key]),
  });

  return (
    <div className="container stack stack-6" style={{ maxWidth: 860 }}>
      <header className="stack stack-2">
        <nav className="small muted">
          <Link to="/manage">Manage</Link> <span aria-hidden="true">/</span>{' '}
          {isEdit ? 'Edit event' : 'New event'}
        </nav>
        <h1>{isEdit ? `Edit "${event.title}"` : 'Create an event'}</h1>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <form className="panel stack stack-6" onSubmit={submit} noValidate>
        <section className="stack stack-4">
          <h2>Basics</h2>

          <div className="field">
            <label className="label" htmlFor="title">
              Event title
            </label>
            <input id="title" className="input" required maxLength={200} {...field('title')} />
            {fieldErrors.title && <span className="error-text">{fieldErrors.title}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              className="textarea"
              required
              minLength={20}
              maxLength={8000}
              placeholder="What should attendees know before they arrive?"
              {...field('description')}
            />
            <span className="hint">
              At least 20 characters. {form.description.trim().length} / 8000
            </span>
            {fieldErrors.description && <span className="error-text">{fieldErrors.description}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="categoryId">
              Category
            </label>
            <select id="categoryId" className="select" required {...field('categoryId')}>
              <option value="">Choose a category</option>
              {categories?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {fieldErrors.categoryId && <span className="error-text">{fieldErrors.categoryId}</span>}
          </div>
        </section>

        <hr className="divider" />

        <section className="stack stack-4">
          <h2>When and where</h2>

          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="date">
                Date
              </label>
              <input
                id="date"
                className="input"
                type="date"
                required
                // A past date is only invalid when creating; an existing past
                // event can still be edited.
                min={isEdit ? undefined : new Date().toISOString().slice(0, 10)}
                {...field('date')}
              />
              {fieldErrors.date && <span className="error-text">{fieldErrors.date}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="startTime">
                Start time
              </label>
              <input id="startTime" className="input" type="time" required {...field('startTime')} />
              {fieldErrors.startTime && <span className="error-text">{fieldErrors.startTime}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="endTime">
                End time <span className="muted">(optional)</span>
              </label>
              <input id="endTime" className="input" type="time" {...field('endTime')} />
              {fieldErrors.endTime && <span className="error-text">{fieldErrors.endTime}</span>}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="venue">
              Venue
            </label>
            <input id="venue" className="input" required maxLength={200} {...field('venue')} />
            {fieldErrors.venue && <span className="error-text">{fieldErrors.venue}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="address">
              Street address <span className="muted">(optional)</span>
            </label>
            <input id="address" className="input" maxLength={255} {...field('address')} />
          </div>

          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="city">
                City
              </label>
              <input id="city" className="input" required maxLength={100} {...field('city')} />
              {fieldErrors.city && <span className="error-text">{fieldErrors.city}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="country">
                Country
              </label>
              <input id="country" className="input" required maxLength={100} {...field('country')} />
              {fieldErrors.country && <span className="error-text">{fieldErrors.country}</span>}
            </div>
          </div>
        </section>

        <hr className="divider" />

        <section className="stack stack-4">
          <h2>Tickets and capacity</h2>

          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="capacity">
                Capacity
              </label>
              <input
                id="capacity"
                className="input"
                type="number"
                min="1"
                max="100000"
                required
                {...field('capacity')}
              />
              {fieldErrors.capacity && <span className="error-text">{fieldErrors.capacity}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="price">
                Price (ZAR)
              </label>
              <input
                id="price"
                className="input"
                type="number"
                min="0"
                step="0.01"
                required
                {...field('price')}
              />
              <span className="hint">Set 0 for a free event.</span>
              {fieldErrors.price && <span className="error-text">{fieldErrors.price}</span>}
            </div>
          </div>

          {!isEdit && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
              />
              Publish immediately
            </label>
          )}
        </section>

        <hr className="divider" />

        <section className="stack stack-4">
          <h2>Optional extras</h2>

          <div className="field">
            <label className="label" htmlFor="imageUrl">
              Cover image URL
            </label>
            <input id="imageUrl" className="input" type="url" placeholder="https://" {...field('imageUrl')} />
            {fieldErrors.imageUrl && <span className="error-text">{fieldErrors.imageUrl}</span>}
          </div>

          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="latitude">
                Latitude
              </label>
              <input
                id="latitude"
                className="input"
                type="number"
                step="any"
                min="-90"
                max="90"
                {...field('latitude')}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="longitude">
                Longitude
              </label>
              <input
                id="longitude"
                className="input"
                type="number"
                step="any"
                min="-180"
                max="180"
                {...field('longitude')}
              />
            </div>
          </div>
          <span className="hint">Provide both coordinates to enable the map link.</span>
        </section>

        <div className="row end row-3">
          <Link to={isEdit ? `/events/${event.id}` : '/manage'} className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-lg" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving' : isEdit ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  );
}
