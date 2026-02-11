import { config } from 'dotenv';

config({ path: '.env.dev' });

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const productId = process.env.PRODUCT_ID;
const userId = process.env.USER_ID;

if (!productId || !userId) {
  console.error('PRODUCT_ID and USER_ID must be set in env');
  process.exit(1);
}

const requests = Number(process.env.REQUESTS ?? 30);

async function run() {
  const body = {
    userId,
    items: [{ id: productId, quantity: 1 }]
  };

  const tasks = Array.from({ length: requests }, () => {
    const idempotencyKey = crypto.randomUUID();
    return fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body)
    }).then(async (res) => ({
      status: res.status,
      body: await res.text()
    }));
  });

  const results = await Promise.all(tasks);
  const ok = results.filter((r) => r.status === 201 || r.status === 200).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  const errors = results.filter((r) => r.status >= 400 && r.status !== 409).length;

  console.log({ requests, ok, conflicts, errors });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
