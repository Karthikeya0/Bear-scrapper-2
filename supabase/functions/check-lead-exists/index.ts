import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, profile_url, domain, name } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // --- Check 1: email exact match ---
    if (email) {
      const { data: lead } = await supabase
        .from('leads').select('id').eq('email', email).maybeSingle()
      if (lead) return Response.json({ exists: true, lead_id: lead.id, match_type: 'email' }, { headers: corsHeaders })

      const { data: raw } = await supabase
        .from('raw_leads').select('id').eq('email', email).maybeSingle()
      if (raw) return Response.json({ exists: true, lead_id: raw.id, match_type: 'email_raw' }, { headers: corsHeaders })
    }

    // --- Check 2: profile URL exact match ---
    if (profile_url) {
      const { data: lead } = await supabase
        .from('leads').select('id').eq('profile_url', profile_url).maybeSingle()
      if (lead) return Response.json({ exists: true, lead_id: lead.id, match_type: 'profile_url' }, { headers: corsHeaders })

      const { data: raw } = await supabase
        .from('raw_leads').select('id').eq('profile_url', profile_url).maybeSingle()
      if (raw) return Response.json({ exists: true, lead_id: raw.id, match_type: 'profile_url_raw' }, { headers: corsHeaders })
    }

    // --- Check 3: fuzzy domain + name match ---
    if (domain && name) {
      const { data: fuzzy } = await supabase.rpc('fuzzy_lead_exists', {
        p_domain: domain,
        p_name: name,
      })
      if (fuzzy && fuzzy.length > 0 && fuzzy[0].exists) {
        return Response.json(
          { exists: true, lead_id: fuzzy[0].lead_id, match_type: 'fuzzy_domain_name' },
          { headers: corsHeaders }
        )
      }

      const { data: fuzzyRaw } = await supabase.rpc('fuzzy_raw_lead_exists', {
        p_domain: domain,
        p_name: name,
      })
      if (fuzzyRaw && fuzzyRaw.length > 0 && fuzzyRaw[0].exists) {
        return Response.json(
          { exists: true, lead_id: fuzzyRaw[0].raw_lead_id, match_type: 'fuzzy_domain_name_raw' },
          { headers: corsHeaders }
        )
      }
    }

    return Response.json({ exists: false }, { headers: corsHeaders })
  } catch (err) {
    console.error('check-lead-exists error:', err)
    return Response.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    )
  }
})
