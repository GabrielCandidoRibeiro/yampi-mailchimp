const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const YAMPI_ALIAS = process.env.YAMPI_ALIAS;
const YAMPI_USER_TOKEN = process.env.YAMPI_USER_TOKEN;
const YAMPI_SECRET_KEY = process.env.YAMPI_SECRET_KEY;
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER;
const PORT = process.env.PORT || 3000;

const yampiHeaders = {
  'User-Token': YAMPI_USER_TOKEN,
  'User-Secret-Key': YAMPI_SECRET_KEY,
  'Content-Type': 'application/json',
};

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor rodando!' });
});

app.post('/webhook/yampi', async (req, res) => {
  try {
    const event = req.body;
    console.log('[YAMPI] Evento recebido:', JSON.stringify(event, null, 2));

    const payload = event?.data || event?.resource || event;
    const trackingData = payload?.tracking_data || {};
    const customer = payload?.customer?.data || payload?.customer || {};

    const email = trackingData?.email || customer?.email || payload?.email || null;
    const name = trackingData?.name || customer?.first_name || '';
    const firstName = name.split(' ')[0] || '';
    const lastName = name.split(' ').slice(1).join(' ') || '';
    const total = payload?.totalizers?.total_formated || '';
    const cartId = String(payload?.id || payload?.token || '');

    if (!email) {
      return res.status(200).json({ received: true, processed: false, reason: 'no_email' });
    }

    await upsertMailchimpContact(email, firstName, lastName, total, cartId);
    res.status(200).json({ success: true, email });
  } catch (err) {
    console.error('[ERRO] Webhook:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/sync', async (req, res) => {
  try {
    console.log('[SYNC] Buscando carrinhos abandonados...');
    const response = await axios.get(
      `https://api.dooki.com.br/v2/${YAMPI_ALIAS}/checkout/carts`,
      { headers: yampiHeaders, params: { include: 'customer', limit: 200 }
    );

    const carts = response.data?.data || [];
    let processed = 0;

    for (const cart of carts) {
      const email = cart?.tracking_data?.email || cart?.customer?.data?.email;
      if (!email) continue;

      const name = cart?.tracking_data?.name || '';
      const firstName = name.split(' ')[0] || '';
      const lastName = name.split(' ').slice(1).join(' ') || '';
      const total = cart?.totalizers?.total_formated || '';
      const cartId = String(cart?.id || '');

      await upsertMailchimpContact(email, firstName, lastName, total, cartId);
      processed++;
      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ success: true, processed });
  } catch (err) {
    console.error('[ERRO] Sync:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

async function upsertMailchimpContact(email, firstName, lastName, total, cartId) {
  const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  const base = `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0`;
  const auth = { username: 'anystring', password: MAILCHIMP_API_KEY };

  try {
    await axios.put(
      `${base}/lists/${MAILCHIMP_LIST_ID}/members/${subscriberHash}`,
      {
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields: { FNAME: firstName, LNAME: lastName },
      },
      { auth }
    );
  } catch (err) {
    console.warn(`[AVISO] Merge fields inválidos para ${email}, tentando sem merge fields...`);
    await axios.put(
      `${base}/lists/${MAILCHIMP_LIST_ID}/members/${subscriberHash}`,
      {
        email_address: email,
        status_if_new: 'subscribed',
      },
      { auth }
    );
  }

  await axios.post(
    `${base}/lists/${MAILCHIMP_LIST_ID}/members/${subscriberHash}/tags`,
    { tags: [{ name: 'carrinho-abandonado', status: 'active' }] },
    { auth }
  );
  console.log(`[MAILCHIMP] Processado: ${email}`);
}

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
