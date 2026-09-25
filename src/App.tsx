import { useEffect } from 'react';
import { useNav } from './state/nav';
import { useSession } from './state/session';
import { useUI } from './state/ui';
import { useLive } from './state/live';
import { PhoneFrame, ToastViewport } from './components/Chrome';
import { Splash } from './screens/Splash';
import { RoleSelect } from './screens/RoleSelect';
import { PatientLogin, StaffLogin } from './screens/Login';
import { PatientHome } from './screens/PatientHome';
import { LiveQueue } from './screens/LiveQueue';
import { Book } from './screens/Book';
import { Confirmation } from './screens/Confirmation';
import { Upcoming, History } from './screens/Appointments';
import { Profile, Settings, NotifPrefs } from './screens/Profile';
import { StaffDashboard, WalkIn } from './screens/StaffDashboard';
import { PatientDetails } from './screens/PatientDetails';
import { QueueMgmt } from './screens/QueueMgmt';
import { DoctorDashboard } from './screens/DoctorDashboard';
import { DailySummary, Analytics } from './screens/Summary';
import { Admin } from './screens/Admin';
import { IconWifiOff } from './components/icons';

export default function App() {
  const stack = useNav((s) => s.stack);
  const theme = useUI((s) => s.theme);
  const offline = useUI((s) => s.offline);
  const lastSync = useLive((s) => s.lastSync);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const screen = stack[stack.length - 1];

  const render = () => {
    switch (screen) {
      case 'splash':
        return <Splash />;
      case 'role_select':
        return <RoleSelect />;
      case 'patient_login':
        return <PatientLogin />;
      case 'staff_login':
        return <StaffLogin />;
      case 'patient_home':
        return <PatientHome />;
      case 'live_queue':
        return <LiveQueue />;
      case 'book':
        return <Book />;
      case 'confirmation':
        return <Confirmation />;
      case 'upcoming':
        return <Upcoming />;
      case 'history':
        return <History />;
      case 'profile':
        return <Profile />;
      case 'settings':
        return <Settings />;
      case 'notif_prefs':
        return <NotifPrefs />;
      case 'staff_dashboard':
        return <StaffDashboard />;
      case 'walk_in':
        return <WalkIn />;
      case 'patient_details':
        return <PatientDetails />;
      case 'queue_mgmt':
        return <QueueMgmt />;
      case 'doctor_dashboard':
        return <DoctorDashboard />;
      case 'daily_summary':
        return <DailySummary />;
      case 'analytics':
        return <Analytics />;
      case 'admin':
        return <Admin />;
      default:
        return <Splash />;
    }
  };

  return (
    <PhoneFrame>
      <div className="screen screen-enter" key={screen}>
        {render()}
        {offline && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(var(--safe-top) + 30px)',
              left: 12,
              right: 12,
              zIndex: 300,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--coral-soft)',
              color: 'var(--coral-deep)',
              borderRadius: 12,
              padding: '9px 12px',
              fontSize: 12.5,
              fontWeight: 800,
              boxShadow: 'var(--shadow-2)',
            }}
            role="alert"
          >
            <IconWifiOff size={15} /> Reconnecting… showing last known queue state
            {lastSync > 0 && <span style={{ fontWeight: 600 }}> · updated {Math.max(0, Math.round((Date.now() - lastSync) / 1000))}s ago</span>}
          </div>
        )}
        <ToastViewport />
      </div>
    </PhoneFrame>
  );
}
