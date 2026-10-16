package com.locus.beacon;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.SparseArray;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * LOCUS Beacon: one app, two roles.
 *   BEACON   : this phone advertises a BLE packet (manufacturer data 0xFFFF, "LC" + beacon id). Put it at a known spot.
 *   RECEIVER : this phone scans for those packets, records RSSI, and serves the LOCUS dashboard + live samples over HTTP.
 * Everything works with no internet: BLE is phone-to-phone, and the dashboard is served by the receiver over a hotspot / local Wi-Fi.
 */
public class MainActivity extends Activity {
    static final int COMPANY = 0xFFFF;
    static final int PORT = 8080;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView status, info;
    private int beaconId = 1;
    private boolean advertising = false, scanning = false;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private SampleServer server;
    private final int[] lastRssi = new int[7];
    private final int[] counts = new int[7];
    private final long[] lastSeen = new long[7];
    private long scanStarted;
    private String mode = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ScrollView sv = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        root.setPadding(p, dp(28), p, p);
        sv.addView(root);
        sv.setBackgroundColor(Color.parseColor("#F4FCFE"));
        setContentView(sv);
        home();
        ui.post(tick);
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private TextView text(String s, int sp, boolean bold, String color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor(color));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private Button button(String s, String bg, View.OnClickListener l) {
        Button x = new Button(this);
        x.setText(s);
        x.setAllCaps(false);
        x.setTextColor(bg.equals("#FFFFFF") ? Color.parseColor("#0B3A4A") : Color.WHITE);
        x.setBackgroundColor(Color.parseColor(bg));
        x.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, dp(6), 0, dp(6));
        x.setLayoutParams(lp);
        return x;
    }

    private void home() {
        stopAll();
        mode = "";
        root.removeAllViews();
        root.addView(text("LOCUS Beacon", 26, true, "#0B3A4A"));
        root.addView(text("Indoor positioning with real Bluetooth. Use two or more phones: some are beacons, one is the receiver.", 15, false, "#3F6572"));
        root.addView(button("This phone is a BEACON", "#10B981", v -> beaconSetup()));
        root.addView(button("This phone is the RECEIVER", "#22C3E6", v -> receiver()));
        root.addView(text("No internet needed. Beacons only advertise over Bluetooth. The receiver serves the dashboard to a laptop over its hotspot / the same Wi-Fi, or you can open it on this phone.", 13, false, "#7A9AA6"));
    }

    // ---------- permissions ----------
    private String[] needed(boolean advertise) {
        List<String> l = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            l.add(advertise ? Manifest.permission.BLUETOOTH_ADVERTISE : Manifest.permission.BLUETOOTH_SCAN);
            l.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (!advertise) l.add(Manifest.permission.ACCESS_FINE_LOCATION);
        return l.toArray(new String[0]);
    }

    private boolean granted(String[] ps) {
        for (String p : ps) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private Runnable afterPerm;

    private void ensure(boolean advertise, Runnable go) {
        String[] ps = needed(advertise);
        if (granted(ps)) { go.run(); return; }
        afterPerm = go;
        requestPermissions(ps, 7);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        boolean ok = res.length > 0;
        for (int r : res) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
        if (ok && afterPerm != null) afterPerm.run();
        else if (status != null) status.setText("Permission denied. Allow Nearby devices (and Location for scanning) in Settings.");
        afterPerm = null;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    // ---------- BEACON ----------
    private void beaconSetup() {
        mode = "beacon";
        root.removeAllViews();
        root.addView(text("Beacon", 24, true, "#0B3A4A"));
        root.addView(text("Pick this phone's beacon number. It must match the # in the dashboard table (and its x, y position).", 14, false, "#3F6572"));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        final Button[] bs = new Button[7];
        for (int i = 1; i <= 6; i++) {
            final int id = i;
            Button x = new Button(this);
            x.setText(String.valueOf(i));
            x.setLayoutParams(new LinearLayout.LayoutParams(0, dp(52), 1));
            x.setOnClickListener(v -> { if (advertising) return; beaconId = id; for (int k = 1; k <= 6; k++) bs[k].setAlpha(k == id ? 1f : 0.45f); });
            x.setAlpha(i == beaconId ? 1f : 0.45f);
            bs[i] = x;
            row.addView(x);
        }
        root.addView(row);
        status = text("Not advertising.", 16, true, "#0B8A5E");
        info = text("", 13, false, "#3F6572");
        root.addView(button("Start advertising", "#10B981", v -> ensure(true, this::startAdvertising)));
        root.addView(button("Stop", "#FFFFFF", v -> stopAdvertising()));
        root.addView(status);
        root.addView(info);
        root.addView(text("Leave the screen on and the app open. Mount the phone at a fixed spot, ideally at the same height as the receiver.", 13, false, "#7A9AA6"));
        root.addView(button("Back", "#FFFFFF", v -> home()));
    }

    private final AdvertiseCallback advCb = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings s) {
            advertising = true;
            status.setText("Advertising as beacon " + beaconId);
            info.setText("Packet: manufacturer 0xFFFF, 'L''C', id " + beaconId + ". Tx power: high, mode: low latency.");
        }
        @Override public void onStartFailure(int e) {
            advertising = false;
            status.setText("Advertising failed (code " + e + ")" + (e == 3 ? ": already running" : e == 5 ? ": this phone does not support BLE advertising" : ""));
        }
    };

    private void startAdvertising() {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { status.setText("Turn Bluetooth on first."); return; }
        advertiser = a.getBluetoothLeAdvertiser();
        if (advertiser == null) { status.setText("This phone cannot advertise over BLE (no peripheral mode). Use it as the receiver instead."); return; }
        if (advertising) advertiser.stopAdvertising(advCb);
        AdvertiseSettings s = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(false).setTimeout(0).build();
        AdvertiseData d = new AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false)
                .addManufacturerData(COMPANY, new byte[]{'L', 'C', (byte) beaconId}).build();
        advertiser.startAdvertising(s, d, advCb);
    }

    private void stopAdvertising() {
        try { if (advertiser != null) advertiser.stopAdvertising(advCb); } catch (Exception ignored) { }
        advertising = false;
        if (status != null) status.setText("Not advertising.");
    }

    // ---------- RECEIVER ----------
    private TextView table;

    private void receiver() {
        mode = "receiver";
        root.removeAllViews();
        root.addView(text("Receiver", 24, true, "#0B3A4A"));
        status = text("Starting…", 16, true, "#0B8A5E");
        info = text("", 14, false, "#0B3A4A");
        table = text("", 14, false, "#0B3A4A");
        table.setTypeface(Typeface.MONOSPACE);
        root.addView(status);
        root.addView(info);
        root.addView(table);
        root.addView(button("Open dashboard on this phone", "#22C3E6", v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:" + PORT + "/")))));
        root.addView(text("Laptop: join this phone's hotspot (or the same Wi-Fi), then open the address above in a browser. No internet is needed.", 13, false, "#3F6572"));
        root.addView(button("Back", "#FFFFFF", v -> home()));
        ensure(false, this::startReceiver);
    }

    private final ScanCallback scanCb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) { handle(r); }
        @Override public void onBatchScanResults(List<ScanResult> rs) { for (ScanResult r : rs) handle(r); }
        @Override public void onScanFailed(int e) { scanning = false; if (status != null) status.setText("Scan failed (code " + e + "). Turn Bluetooth off and on."); }
    };

    private void handle(ScanResult r) {
        if (r.getScanRecord() == null) return;
        SparseArray<byte[]> m = r.getScanRecord().getManufacturerSpecificData();
        byte[] d = m == null ? null : m.get(COMPANY);
        if (d == null || d.length < 3 || d[0] != 'L' || d[1] != 'C') return;
        int id = d[2];
        if (id < 1 || id > 6) return;
        if (server != null) server.add(id, r.getRssi());
        lastRssi[id] = r.getRssi();
        counts[id]++;
        lastSeen[id] = System.currentTimeMillis();
    }

    private void startReceiver() {
        try {
            if (server == null) { server = new SampleServer(getAssets(), PORT, Build.MODEL); server.start(); }
        } catch (Exception e) { status.setText("Could not start server: " + e.getMessage()); return; }
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { status.setText("Turn Bluetooth on first."); return; }
        if (Build.VERSION.SDK_INT < 31 && Build.VERSION.SDK_INT >= 28) {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && !lm.isLocationEnabled()) { status.setText("Turn Location ON (Android needs it for Bluetooth scanning). Nothing is sent anywhere."); return; }
        }
        scanner = a.getBluetoothLeScanner();
        if (scanner == null) { status.setText("Bluetooth scanner unavailable."); return; }
        ScanFilter f = new ScanFilter.Builder().setManufacturerData(COMPANY, new byte[]{'L', 'C'}, new byte[]{(byte) 0xFF, (byte) 0xFF}).build();
        ScanSettings s = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build();
        List<ScanFilter> fl = new ArrayList<>();
        fl.add(f);
        scanner.startScan(fl, s, scanCb);
        scanning = true;
        scanStarted = System.currentTimeMillis();
        for (int i = 0; i < 7; i++) { counts[i] = 0; lastSeen[i] = 0; }
        status.setText("Scanning for beacons…");
    }

    private void stopAll() {
        stopAdvertising();
        try { if (scanner != null && scanning) scanner.stopScan(scanCb); } catch (Exception ignored) { }
        scanning = false;
        if (server != null) { server.stop(); server = null; }
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (mode.equals("receiver") && table != null) {
                StringBuilder sb = new StringBuilder();
                long now = System.currentTimeMillis();
                double secs = Math.max(1, (now - scanStarted) / 1000.0);
                int heard = 0;
                for (int i = 1; i <= 6; i++) {
                    boolean live = lastSeen[i] > 0 && now - lastSeen[i] < 3000;
                    if (live) heard++;
                    sb.append("Beacon ").append(i).append(live ? String.format("  %4d dBm  %4.1f/s", lastRssi[i], counts[i] / secs) : "  –").append('\n');
                }
                table.setText(sb.toString());
                if (scanning) status.setText(heard + " beacon" + (heard == 1 ? "" : "s") + " in range · " + (server == null ? 0 : server.total()) + " packets");
                StringBuilder u = new StringBuilder("Dashboard address:\n");
                for (String ip : ips()) u.append("http://").append(ip).append(':').append(PORT).append("/\n");
                if (ips().isEmpty()) u.append("(no network yet: switch on this phone's hotspot, or join Wi-Fi)\nOn this phone: http://127.0.0.1:").append(PORT).append("/\n");
                info.setText(u.toString());
            }
            ui.postDelayed(this, 700);
        }
    };

    private List<String> ips() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
            }
        } catch (Exception ignored) { }
        return out;
    }

    @Override
    protected void onDestroy() {
        stopAll();
        super.onDestroy();
    }
}
