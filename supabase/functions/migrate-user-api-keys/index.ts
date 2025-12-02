import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES-256-GCM encryption using Web Crypto API
async function encrypt(text: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  
  // Convert hex key to buffer
  const keyBuffer = new Uint8Array(key.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // Convert to hex
  return Array.from(combined)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Get global API keys from secrets
    const apiKey = Deno.env.get('BITGET_API_KEY');
    const secretKey = Deno.env.get('BITGET_SECRET_KEY');
    const passphrase = Deno.env.get('BITGET_PASSPHRASE');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!apiKey || !secretKey || !passphrase) {
      throw new Error('Global Bitget API keys not found in secrets');
    }

    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    console.log('Migrating global API keys for user:', user.id);

    // Check if user already has keys
    const { data: existingKeys } = await supabaseClient
      .from('user_api_keys')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingKeys) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'User already has API keys configured',
          alreadyExists: true
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Encrypt keys
    console.log('Encrypting API keys...');
    const encryptedApiKey = await encrypt(apiKey, encryptionKey);
    const encryptedSecretKey = await encrypt(secretKey, encryptionKey);
    const encryptedPassphrase = await encrypt(passphrase, encryptionKey);

    // Save to database
    console.log('Saving encrypted keys to database...');
    const { error } = await supabaseClient
      .from('user_api_keys')
      .insert({
        user_id: user.id,
        api_key_encrypted: encryptedApiKey,
        secret_key_encrypted: encryptedSecretKey,
        passphrase_encrypted: encryptedPassphrase,
        is_active: true,
        last_validated_at: new Date().toISOString(),
      });

    if (error) throw error;

    console.log('Migration successful for user:', user.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'API keys migrated successfully from global secrets',
        alreadyExists: false
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in migrate-user-api-keys:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
