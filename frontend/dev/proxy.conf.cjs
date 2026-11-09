const target = `http://127.0.0.1:${process.env.QRR_MOCK_PORT || 8089}`;
module.exports = {
  '/custom/qrrouter/**': { target },
  '/__mock/**': { target },
  '/product/**': { target },
  '/mrp/**': { target },
  '/commande/**': { target },
  '/expedition/**': { target },
  '/user/**': { target },
  '/fourn/**': { target },
};
