const fs = require('fs');
const http = require('http');

const ccxt = require('ccxt');
const ws = require('ws');

const auth = JSON.parse(fs.readFileSync('auth.json').toString());

console.log(auth);

const banned = {};

const exchangesArray = 
  auth.exchanges
    .filter(({enabled}) => enabled)
    .map(({id, nickname, auth}) => {
      return {nickname, id, api: new ccxt[id](auth)};
    });

const exchanges = exchangesArray.reduce((acc, ex) => {
  acc[ex.nickname || ex.id] = ex;
  return acc;
}, {});

Object.keys(exchanges).forEach(a => banned[a] = {});

const balances = {};
const accounts = {};
const markets = {};
const tickers = {};
const orders = {};

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

    const [side, amount, market, price, exchange] = JSON.parse(data);

    console.log(JSON.parse(data));
    console.log(side, amount, market, price, exchange);

    if (side === 'refreshInterval') {
      clearInterval(loadDataInterval);

      loadDataInterval = setInterval(loadExchangeData, amount * 1000);

      return;
    }

    switch (side) {
    case 'buy':
      exchanges[exchange].api.createOrder(market, 'limit', 'buy', amount, price)
        .then(ret => console.log('buy ret', ret))
        .catch(e => handleOrderError(e, 'buy', exchange, market, 'limit', amount, price));
      break;
    case 'sell':
      exchanges[exchange].api.createOrder(market, 'limit', 'sell', amount, price)
        .then(ret => console.log('sell ret', ret))
        .catch(e => handleOrderError(e, 'sell', exchange, market, 'limit', amount, price));
      break;
    }
  });

  ws.send(JSON.stringify(['exchanges', exchangesArray.map(({nickname, id}) => ({nickname: nickname || id}))]));

  Object.keys(balances)
    .forEach(nickname => {
      const b = balances[nickname];

      if (b) ws.send(JSON.stringify(createBalancesMessage(nickname, b)));
    });

  Object.keys(accounts)
    .forEach(nickname => {
      const b = accounts[nickname];

      if (b) ws.send(JSON.stringify(createAccountsMessage(nickname, b)));
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


  Object.keys(orders)
    .forEach(name => {
      const t = orders[name];

      if (t) ws.send(JSON.stringify(createOrdersMessage(name, t)));
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
loadExchangeOrders();

let loadDataInterval = setInterval(loadExchangeData, 60 * 1000);

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

    console.log('fetching', nickname || id, 'accounts');
    api.fetchAccounts()
      .then(data => {
        accounts[name] = data;
        broadcast(createAccountsMessage(name, data));
      })
      .catch(err => console.log('error fetching accounts', name, err));

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

function loadExchangeOrders() {
  exchangesArray.forEach(ex => {
    const {id, nickname, api} = ex;
    const name = nickname || id;

    console.log('fetching', name, 'orders');
    api.fetchClosedOrders()
      .then(data => {
        orders[name] = data;
        broadcast(createOrdersMessage(name, data));
      })
      .catch(err => console.log('error fetching orders', name, err));

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

function createAccountsMessage(exchange, data) {
  return ['accounts', {
    exchange,
    accounts: data
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

function createOrdersMessage(exchange, data) {
  return ['orders', {exchange, data}];
}

function handleOrderError(e, direction, exchange, market, type, amount, price) {
  console.log('order error', direction, e);
  console.log(typeof(e));
  try {
    console.log(JSON.stringify(e));
    if (e.kraken.match(/EAccount:Invalid permissions:\w+ trading restricted/)) {
      banned[exchange][market] = true;
      console.log(banned);

      broadcast(['banned', banned]);
    }
  }
  catch (e) {
    console.log('error', e);0
  }
}