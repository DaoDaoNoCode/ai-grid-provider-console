import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNotifications } from '../notifications/useNotifications';

type NoticeState = { notice?: string } | null;

// Ported from krisv/ai-grid-cloud-provider-poc src/app/App.tsx at 62319b8.
/**
 * Shows `navigate(path, { state: { notice } })` as a success toast through the notification center,
 * so it looks like every other toast (NotificationToasts): it closes when it is closed, it times out,
 * or the user moves on to another page. It is kept in the drawer as read: the user saw it, in answer
 * to their own click.
 */
export const NoticeToast: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  // Once per navigation, whatever React runs twice.
  const shown = useRef<string>(undefined);
  useEffect(() => {
    const state = location.state as NoticeState;
    if (!state?.notice) return;
    if (shown.current !== location.key) {
      shown.current = location.key;
      notify({ variant: 'success', title: state.notice, read: true, page: location.pathname });
    }
    // Once taken, the notice leaves its history entry (the same page, replaced without it), so Back
    // to that entry doesn't show it again. The replace stays on the page, so the toast stays too.
    const rest = { ...state };
    delete rest.notice;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(rest).length > 0 ? rest : null },
    );
  }, [location, navigate, notify]);
  return null;
};
