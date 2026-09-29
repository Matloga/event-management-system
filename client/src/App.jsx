import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import { Spinner } from './components/Feedback.jsx';
import Home from './pages/Home.jsx';
import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

/* Route-split the heavier authenticated screens. */
const CreateEvent = lazy(() => import('./pages/CreateEvent.jsx'));
const EditEvent = lazy(() => import('./pages/EditEvent.jsx'));
const MyTickets = lazy(() => import('./pages/MyTickets.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const EventManage = lazy(() => import('./pages/EventManage.jsx'));
const CheckIn = lazy(() => import('./pages/CheckIn.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));

export default function App() {
  return (
    <div className="app-shell">
      <Header />

      <main className="app-main">
        <Suspense fallback={<Spinner label="Loading" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route
              path="/events/new"
              element={
                <ProtectedRoute requireRole={['organizer', 'admin']}>
                  <CreateEvent />
                </ProtectedRoute>
              }
            />
            <Route
              path="/events/:id/edit"
              element={
                <ProtectedRoute requireRole={['organizer', 'admin']}>
                  <EditEvent />
                </ProtectedRoute>
              }
            />
            <Route
              path="/events/:id/manage"
              element={
                <ProtectedRoute requireRole={['organizer', 'admin']}>
                  <EventManage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/tickets"
              element={
                <ProtectedRoute>
                  <MyTickets />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manage"
              element={
                <ProtectedRoute requireRole={['organizer', 'admin']}>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireRole={['admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/check-in"
              element={
                <ProtectedRoute requireRole={['organizer', 'admin']}>
                  <CheckIn />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}
