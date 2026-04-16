Setup

1. Install dependencies inside functions folder:
   cd functions
   npm install

2. Deploy / emulate with Firebase CLI. Set the server key in env or functions config:
   firebase functions:config:set maps.key="YOUR_SERVER_SIDE_GOOGLE_MAPS_API_KEY"

3. In production use environment variables in your cloud provider to store `GOOGLE_MAPS_API_KEY` and do not commit secrets.

Usage

Call via HTTPS:
GET https://us-central1-<project>.cloudfunctions.net/getDistance?origin=...&destination=...

Response: { miles: number | null, raw: <distance-matrix-response> }
