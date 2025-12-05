import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { createHmac } from 'node:crypto';

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

async function decrypt(encryptedHex: string, key: string): Promise<string> {
  // Convert hex to buffer
  const encrypted = new Uint8Array(
    encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  
  // Extract IV and data
  const iv = encrypted.slice(0, 12);
  const data = encrypted.slice(12);
  
  // Convert hex key to buffer
  const keyBuffer = new Uint8Array(key.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Validate Bitget API keys by making a test API call
async function validateBitgetKeys(apiKey: string, secretKey: string, passphrase: string): Promise<boolean> {
  try {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const requestPath = '/api/v2/mix/account/accounts?productType=USDT-FUTURES';
    
    // Create signature
    const prehash = timestamp + method + requestPath;
    const signature = createHmac('sha256', secretKey)
      .update(prehash)
      .digest('base64');
    
    const response = await fetch(`https://api.bitget.com${requestPath}`, {
      method: method,
      headers: {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US'
      }
    });
    
    const data = await response.json();
    
    // Check if the response is successful
    return data.code === '00000';
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
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

    const { action, apiKey, secretKey, passphrase } = await req.json();
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    if (action === 'save') {
      // Validate keys first
      console.log('Validating Bitget API keys...');
      const isValid = await validateBitgetKeys(apiKey, secretKey, passphrase);
      
      if (!isValid) {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid API keys. Please check your credentials and try again.',
            validated: false 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      console.log('API keys validated successfully');

      // Encrypt keys
      const encryptedApiKey = await encrypt(apiKey, encryptionKey);
      const encryptedSecretKey = await encrypt(secretKey, encryptionKey);
      const encryptedPassphrase = await encrypt(passphrase, encryptionKey);

      // Save to database - use onConflict to handle existing records
      const { error } = await supabaseClient
        .from('user_api_keys')
        .upsert({
          user_id: user.id,
          api_key_encrypted: encryptedApiKey,
          secret_key_encrypted: encryptedSecretKey,
          passphrase_encrypted: encryptedPassphrase,
          is_active: true,
          last_validated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'API keys saved and validated successfully',
          validated: true 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'get') {
      // Get encrypted keys from database
      const { data, error } = await supabaseClient
        .from('user_api_keys')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (!data) {
        return new Response(
          JSON.stringify({ exists: false }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({ 
          exists: true,
          isActive: data.is_active,
          lastValidated: data.last_validated_at,
          createdAt: data.created_at
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'delete') {
      const { error } = await supabaseClient
        .from('user_api_keys')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: 'API keys deleted successfully' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'validate') {
      // Get and decrypt keys, then validate
      const { data, error } = await supabaseClient
        .from('user_api_keys')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;

      const decryptedApiKey = await decrypt(data.api_key_encrypted, encryptionKey);
      const decryptedSecretKey = await decrypt(data.secret_key_encrypted, encryptionKey);
      const decryptedPassphrase = await decrypt(data.passphrase_encrypted, encryptionKey);

      const isValid = await validateBitgetKeys(decryptedApiKey, decryptedSecretKey, decryptedPassphrase);

      // Update validation timestamp if successful
      if (isValid) {
        await supabaseClient
          .from('user_api_keys')
          .update({ last_validated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }

      return new Response(
        JSON.stringify({ 
          valid: isValid,
          message: isValid ? 'API keys are valid' : 'API keys validation failed'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    throw new Error('Invalid action');
  } catch (error) {
    console.error('Error in manage-api-keys:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
