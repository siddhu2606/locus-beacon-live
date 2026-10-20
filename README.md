# LOCUS Beacon

Indoor positioning from **real Bluetooth signal strength** with phones as beacons, a phone as receiver, and a live dashboard on a laptop. Works **offline**. Built for CodeApex Track 4 PS2 (AI-based indoor positioning with sparse infrastructure and noisy measurements).

- Site: https://siddhu2606.github.io/locus-beacon-live/
- Demo dashboard (simulated Bluetooth): https://siddhu2606.github.io/locus-beacon-live/dashboard.html?demo
- Android app: see the latest release in this repo.

## How it works
1. **Beacon phones** (Android) advertise a BLE packet: manufacturer data `0xFFFF`, bytes `L C <id>`.
2. **Receiver phone** scans, records RSSI per beacon, and runs a tiny built-in HTTP server on port 8080 that serves the dashboard and `/api/samples?since=N`.
3. **Laptop** opens `http://<receiver-ip>:8080/`. The page converts RSSI to range (log-distance model, per-beacon 1 m calibration), then runs the LOCUS engine: per-beacon trust scoring, particle filter with motion history, a position and a 90% ellipse. Range error is modelled as proportional to range (RSSI error is multiplicative in distance).

## Dashboard tools (v1.2)
- **Beacon health:** a status dot per beacon and a banner that names the problem: no packets, weak signal, low packet rate, down-weighted, fewer than 3 heard, or beacons almost in a line.
- **Movement trail:** fading trail, adjustable length (5-120 s), clear/off, and walked path length.
- **Guided calibration:** walks through each beacon for the 1 m reading, rejecting too few packets or a jumpy signal.
- **Saved layouts:** named layouts in the browser, JSON export/import, and the last setup restored automatically.
- Test: `node scripts/test_features.js`.

## Offline
No internet anywhere: BLE is phone to phone, the dashboard is bundled in the APK, and the receiver's hotspot (or any Wi-Fi) carries the page. The receiver also has **Open dashboard on this phone** for a one-phone view. The GitHub Pages site only hosts the demo and download.

## Minimum number of beacons
See [docs/BEACON_STUDY.html](docs/BEACON_STUDY.html). Short version: 3 in a triangle is the practical minimum, 4 is the sensible deployment, never 3 in a line. Median errors in the simulated 8 x 6 m room at typical noise (4 dB): 2 beacons 1.26 m, 3 (triangle) 1.02 m, 4 (square) 0.97 m, 6 beacons 0.77 m.

## Run it
- Android: install the APK from Releases (debug-signed; allow install from unknown sources). Grant Nearby devices / Location. Beacon phones: pick a number 1-6 and start. Receiver: tap Receiver.
- Dashboard: tick beacons, set each one's x, y to match where you put the phone, stand 1 m from a beacon and press its **1 m** button to calibrate. Click the map where you really stand to log an error sample; download the CSV.
- Build the app: `cd android && ./gradlew assembleDebug` (needs JDK 17 and the Android SDK, platform 36). Rebuild the dashboard with `python build.py`.

## Tests
- `node scripts/test_dashboard.js`: headless Chrome. Demo accuracy for 2/3/4/6 beacons, and live mode against a mock receiver that speaks the same API as the app (estimate follows a moving person, survives losing a beacon).
- `node scripts/sim_beacons.js`: the beacon-count study.
- The APK was installed on an Android emulator, the receiver started, and the served page was byte-identical to `dashboard.html`.

## Honest limits
- **Not yet tested on real Bluetooth hardware.** The radio path (advertise on one phone, scan on another) is standard Android API code that compiled and ran on an emulator, but the emulator has no real radio. Treat the first real run as a test.
- BLE RSSI is noisy (4-8 dB is normal). Expect 1-2 m typical error, not centimetres.
- Phones must support BLE advertising (most from the last ~6 years). iPhones are not supported.
- Keep the screen on and the app open; there is no background service yet.
- Android throttles scanning if restarted often. The app starts one scan and keeps it.
- The ML trust scorer from the earlier LOCUS project is not used here; the heuristic scorer is.

Engine: from [LOCUS](https://github.com/vidulaj382-sys/LOCUS), extended with an optional per-measurement uncertainty.
