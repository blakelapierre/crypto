const fs = require('fs');
const http = require('http');

const ccxt = require('ccxt');
const ws = require('ws');

const auth = JSON.parse(fs.readFileSync('auth.json').toString());

console.log(auth);

const exchangesArray = 
  auth.exchanges
    .filter(({enabled}) => enabled)
    .map(({id, nickname, auth}) => {
      return {nickname, id, api: new ccxt[id](auth)};
    });

const exchanges = exchangesArray.reduce((acc, ex) => {
  acc[ex.nickname] = ex;
  return acc;
}, {});

const accounts = auth.exchanges

const balances = {};
const markets = {};
const tickers = {};

const wss = new ws.WebSocketServer({ port: 8081 });

if (exchanges['coinbase main']) {
  console.log(exchanges['coinbase main'].fetchAccounts)
  exchanges['coinbase main'].api.fetch_accounts()
    .then(data => {
      console.log('coinbase accounts', data);
    })
    .catch(error => {
      console.log('error fetching coinbase accounts', error);
    });
}

wss.on('connection', function connection(ws) {
  console.log('ws connected');
  ws.on('error', console.error);

  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.send(JSON.stringify(['exchanges', exchangesArray.map(({nickname, id}) => ({nickname: nickname || id}))]));

  Object.keys(balances)
    .forEach(nickname => {
      const b = balances[nickname];

      if (b) ws.send(JSON.stringify(createBalancesMessage(nickname, b)));
    });

  Object.keys(markets)
    .forEach(name => {
      const m = markets[name];

      if (m) ws.send(JSON.stringify(createMarketsMessage(name, m)));
    });

  Object.keys(tickers)
    .forEach(name => {
      const t = tickers[name];

      if (t) ws.send(JSON.stringify(createTickersMessage(name, t)));
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

loadExchangeData();

setInterval(loadExchangeData, 60 * 1000);

function loadExchangeData() {
  exchangesArray.forEach(ex => {
    const {id, nickname, api} = ex;
    const name = nickname || id;

    console.log('fetching', nickname || id, 'balances');
    api.fetchBalance()
      .then(data => {
        balances[name] = data;
        broadcast(createBalancesMessage(name, data));
      })
      .catch(err => console.log('error fetching balances', name, err));

    console.log('fetching', name, 'markets');
    api.fetchMarkets()
      .then(data => {
        markets[name] = data;
        broadcast(createMarketsMessage(name, data));
      })
      .catch(err => console.log('error fetching markets', name, err));

    console.log('fetching', name, 'tickers');
    api.fetchTickers()
      .then(data => {
        tickers[name] = data;
        broadcast(createTickersMessage(name, data));
      })
      .catch(err => console.log('error fetching tickets', name, err));
  });
}

function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === ws.WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function createBalancesMessage(exchange, {total, free, used}) {
  return ['balances', {
    exchange,
    balances: {
      total,
      free,
      used
    }
  }];
}

function createMarketsMessage(exchange, markets) {
  return ['markets', {
    exchange,
    markets
  }];
}

function createTickersMessage(exchange, tickers) {
  return ['tickers', {
    exchange,
    tickers
  }];
}