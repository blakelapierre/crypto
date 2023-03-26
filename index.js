const fs = require('fs');
const http = require('http');

const ccxt = require('ccxt');
const ws = require('ws');

const auth = JSON.parse(fs.readFileSync('auth.json').toString());

console.log(auth);

const exchanges = 
  auth.exchanges
    .filter(({enabled}) => enabled)
    .map(({id, enabled, auth}) => {
      return new ccxt[id](auth);
    });

const balances = {};

const wss = new ws.WebSocketServer({ port: 8081 });

wss.on('connection', function connection(ws) {
  console.log('ws connected');
  ws.on('error', console.error);

  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.send(JSON.stringify(['exchanges', exchanges.map(({id}) => ({id}))]));

  Object.keys(balances)
    .forEach(exchangeId => {
      const b = balances[exchangeId];

      if (b) ws.send(JSON.stringify(['balanaces', {exchange: exchangeId, balances: b}]))
    });
});

const index = fs.readFileSync('index.html');

const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end(index);
});

httpServer.listen({port: 8080});

console.log('httpServer listening on', httpServer.port);
console.log('wss listening on', wss.port);

exchanges.forEach(ex => {
  ex.fetchBalance()
    .then(data => {
      console.log(data);
      balances[ex.id] = data.info.data;
      broadcast(['balances', {exchange: ex.id, balances: data.info.data}])
    })
    .catch(err => console.log('error fetching balances', ex.id, err));
});

function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === ws.WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}