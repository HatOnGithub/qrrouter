# Optional local jsQR decoder

For Firefox/offline deployments, place `jsQR.js` (version 1.4.0, Apache-2.0) in this folder. QR Router automatically uses it instead of jsDelivr when the file is present.

Source: https://github.com/cozmo/jsQR/tree/master/dist

Download on a machine with internet access:

```sh
curl --fail --location https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js -o jsQR.js
```

Review/approve any third-party code before deploying. Retain the upstream Apache-2.0 license and notices: https://github.com/cozmo/jsQR/blob/master/LICENSE
