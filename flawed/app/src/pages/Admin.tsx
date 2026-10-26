import { useState } from 'react';
import { supabaseAdmin } from '../lib/supabase';
import { useProfile } from '../hooks/useProfile';

export default function Admin() {
  const { profile } = useProfile();
  const [userId, setUserId] = useState('');
  const [credits, setCredits] = useState(10);

  // Only admins see the page; the key behind it ships to every visitor.
  if (!profile?.is_admin) return null;

  async function grant() {
    const { data } = await supabaseAdmin.from('profiles').select('credits').eq('id', userId).single();
    await supabaseAdmin.from('profiles').update({ credits: (data?.credits ?? 0) + credits }).eq('id', userId);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); grant(); }}>
      <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User id" />
      <input type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
      <button>Grant credits</button>
    </form>
  );
}
