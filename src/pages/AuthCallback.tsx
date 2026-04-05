import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const PKCE_VERIFIER_MISSING_PATTERNS = [
  'pkce',
  'code verifier',
  'flow_state',
  'flow state',
  'missing',
  'no verifier',
  'auth code',
];

function isPkceVerifierMissing(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  return PKCE_VERIFIER_MISSING_PATTERNS.some(p => lower.includes(p));
}

async function getRoleFromSession(): Promise<'admin' | 'user'> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const authUser = sessionData?.session?.user;
    if (!authUser) return 'user';

    const { data: row } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (row?.role === 'admin') return 'admin';

    if (!row) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('role')
        .eq('email', authUser.email!)
        .maybeSingle();
      if (byEmail?.role === 'admin') return 'admin';
    }
  } catch {
    /* ignore — fall through to 'user' */
  }
  return 'user';
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const safetyTimer = setTimeout(() => {
      navigate('/auth?error=' + encodeURIComponent('Verification timed out. Please sign in.'), { replace: true });
    }, 12_000);

    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hashStr = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hashStr);

        const urlError = urlParams.get('error') || hashParams.get('error');
        const errorDesc = urlParams.get('error_description') || hashParams.get('error_description');
        if (urlError) {
          clearTimeout(safetyTimer);
          navigate('/auth?error=' + encodeURIComponent(errorDesc || urlError), { replace: true });
          return;
        }

        const code = urlParams.get('code') || hashParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            clearTimeout(safetyTimer);

            if (isPkceVerifierMissing(error.message ?? '')) {
              navigate(
                '/auth?error=' +
                  encodeURIComponent(
                    'Your account is confirmed! This link only works in the browser where you signed up. ' +
                    'Please sign in with your email and password.'
                  ),
                { replace: true }
              );
              return;
            }

            if ((error.message ?? '').toLowerCase().includes('expired') ||
                (error.message ?? '').toLowerCase().includes('already used')) {
              navigate(
                '/auth?error=' +
                  encodeURIComponent('This confirmation link has expired. Please sign in — your account may already be confirmed.'),
                { replace: true }
              );
              return;
            }

            navigate(
              '/auth?error=' + encodeURIComponent(error.message || 'Confirmation failed. Please try signing in.'),
              { replace: true }
            );
            return;
          }

          if (data.session) {
            clearTimeout(safetyTimer);
            const type = urlParams.get('type');
            if (type === 'recovery') {
              navigate('/auth/reset-password', { replace: true });
              return;
            }
            const role = await getRoleFromSession();
            navigate(role === 'admin' ? '/admin' : '/dashboard', { replace: true });
            return;
          }
        }

        const accessToken = hashParams.get('access_token');
        if (accessToken) {
          const type = hashParams.get('type');
          if (type === 'recovery') {
            clearTimeout(safetyTimer);
            navigate('/auth/reset-password' + window.location.hash, { replace: true });
            return;
          }
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: hashParams.get('refresh_token') ?? '',
          });
          clearTimeout(safetyTimer);
          if (!error && data.session) {
            const role = await getRoleFromSession();
            navigate(role === 'admin' ? '/admin' : '/dashboard', { replace: true });
          } else {
            navigate('/auth', { replace: true });
          }
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        clearTimeout(safetyTimer);
        if (sessionData.session) {
          const role = await getRoleFromSession();
          navigate(role === 'admin' ? '/admin' : '/dashboard', { replace: true });
        } else {
          navigate('/auth', { replace: true });
        }

      } catch (err) {
        console.error('[Salarn] AuthCallback error:', err);
        clearTimeout(safetyTimer);
        navigate('/auth', { replace: true });
      }
    };

    handleCallback();
    return () => clearTimeout(safetyTimer);
  }, [navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl gradient-green flex items-center justify-center glow-green-sm animate-pulse">
          <TrendingUp className="w-6 h-6 text-white" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Verifying your account…</p>
        </div>
      </div>
    </div>
  );
}
