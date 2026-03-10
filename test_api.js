// Test API endpoints
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  headers: {
    'Host': 'fmd.localhost:3000',
    'Content-Type': 'application/json'
  }
};

function request(path, method = 'GET', body = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, path, method, headers: { ...options.headers, 'Cookie': cookies } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Get Set-Cookie header if present
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, data: JSON.parse(data || '{}'), setCookie });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('=== TEST API ===\n');
  
  // 1. Test login
  console.log('1. POST /api/login');
  const login = await request('/api/login', 'POST', { username: 'alex1', password: 'test123' });
  console.log('   Status:', login.status);
  console.log('   User:', login.data.user?.username);
  
  const cookie = login.setCookie ? login.setCookie[0].split(';')[0] : '';
  console.log('   Cookie:', cookie ? 'OK' : 'NONE');
  
  if (cookie) {
    // 2. Test clients
    console.log('\n2. GET /api/clients-flat');
    const clients = await request('/api/clients-flat', 'GET', null, cookie);
    console.log('   Status:', clients.status);
    console.log('   Count:', Array.isArray(clients.data) ? clients.data.length : 'N/A');
    
    // 3. Test products
    console.log('\n3. GET /api/products-flat');
    const products = await request('/api/products-flat', 'GET', null, cookie);
    console.log('   Status:', products.status);
    console.log('   Count:', Array.isArray(products.data) ? products.data.length : 'N/A');
    
    // 4. Test orders
    console.log('\n4. GET /api/orders');
    const orders = await request('/api/orders', 'GET', null, cookie);
    console.log('   Status:', orders.status);
    console.log('   Count:', Array.isArray(orders.data) ? orders.data.length : 'N/A');
    
    // 5. Test stock
    console.log('\n5. GET /api/stock');
    const stock = await request('/api/stock', 'GET', null, cookie);
    console.log('   Status:', stock.status);
    console.log('   Count:', Array.isArray(stock.data) ? stock.data.length : 'N/A');
    
    // 6. Test drivers
    console.log('\n6. GET /api/drivers');
    const drivers = await request('/api/drivers', 'GET', null, cookie);
    console.log('   Status:', drivers.status);
    console.log('   Count:', Array.isArray(drivers.data) ? drivers.data.length : 'N/A');
    
    // 7. Test vehicles
    console.log('\n7. GET /api/vehicles');
    const vehicles = await request('/api/vehicles', 'GET', null, cookie);
    console.log('   Status:', vehicles.status);
    console.log('   Count:', Array.isArray(vehicles.data) ? vehicles.data.length : 'N/A');
    
    // 8. Test me
    console.log('\n8. GET /api/me');
    const me = await request('/api/me', 'GET', null, cookie);
    console.log('   Status:', me.status);
    console.log('   LoggedIn:', me.data.loggedIn);
  }
  
  console.log('\n=== TEST COMPLET ===');
  process.exit(0);
}

test().catch(e => {
  console.error('Eroare:', e.message);
  process.exit(1);
});
