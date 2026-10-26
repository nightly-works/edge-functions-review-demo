import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useProfile } from '../hooks/useProfile';

export default function Admin() {
  const { profile } = useProfile();
  const [userId, setUserId] = useState('');
  const [credits, setCredits] = useState(10);
  const [message, setMessage] = useState('');

  // Hiding the page is cosmetic: admin-grant-credits checks the caller's role on the server.
  if (!profile?.is_admin) return null;

  async function grant() {
    const { error } = await supabase.functions.invoke('admin-grant-credits', { body: { user_id: userId, credits } });
    setMessage(error ? error.message : `Granted ${credits} credits`);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); grant(); }}>
      <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User id" />
      <input type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
      <button>Grant credits</button>
      <p>{message}</p>
    </form>
  );
}
