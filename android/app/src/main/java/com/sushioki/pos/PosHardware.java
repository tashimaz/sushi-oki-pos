package com.sushioki.pos;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "PosHardware", permissions = {
    @Permission(alias = "nearby", strings = { Manifest.permission.BLUETOOTH_CONNECT })
})
public class PosHardware extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private final java.util.concurrent.ExecutorService io = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timeout = Executors.newSingleThreadScheduledExecutor();

    private BluetoothAdapter adapter() throws IOException {
        BluetoothManager manager = getContext().getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) throw new IOException("เปิด Bluetooth ก่อน");
        return adapter;
    }

    private boolean allowed(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31 || getPermissionState("nearby") == PermissionState.GRANTED) return true;
        requestPermissionForAlias("nearby", call, "permissionResult");
        return false;
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (getPermissionState("nearby") != PermissionState.GRANTED) {
            call.reject("อนุญาตอุปกรณ์ใกล้เคียงในการตั้งค่า Android", "NOT_SENT");
            return;
        }
        switch (call.getMethodName()) {
            case "devices": devices(call); break;
            case "connect": connect(call); break;
            case "send": send(call); break;
            default: call.reject("ไม่พบคำสั่ง Bluetooth", "NOT_SENT");
        }
    }

    @PluginMethod
    public void pair(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
            call.resolve();
        } catch (Exception error) {
            call.reject("เปิดการตั้งค่า Bluetooth ไม่สำเร็จ", error);
        }
    }

    @PluginMethod
    public void devices(PluginCall call) {
        if (!allowed(call)) return;
        try {
            JSArray devices = new JSArray();
            for (BluetoothDevice d : adapter().getBondedDevices()) {
                if (d.getType() == BluetoothDevice.DEVICE_TYPE_LE) continue;
                devices.put(new JSObject().put("name", d.getName() == null ? d.getAddress() : d.getName())
                    .put("address", d.getAddress()));
            }
            call.resolve(new JSObject().put("devices", devices));
        } catch (Exception error) {
            call.reject("อ่านอุปกรณ์ที่จับคู่ไม่ได้ ตรวจสอบ Bluetooth", "NOT_SENT", error);
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (allowed(call)) transmit(call, false);
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (allowed(call)) transmit(call, true);
    }

    private void transmit(PluginCall call, boolean print) {
        io.execute(() -> {
            boolean startedWriting = false;
            try {
                byte[] data = print ? Base64.decode(call.getString("data"), Base64.DEFAULT) : null;
                BluetoothDevice device = adapter().getRemoteDevice(call.getString("address"));
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) throw new IOException("จับคู่อุปกรณ์ก่อน");
                try (BluetoothSocket socket = device.createInsecureRfcommSocketToServiceRecord(SPP)) {
                    var deadline = timeout.schedule(() -> {
                        try { socket.close(); } catch (IOException ignored) { }
                    }, 25, TimeUnit.SECONDS);
                    try {
                        socket.connect();
                        if (print) {
                            OutputStream output = socket.getOutputStream();
                            startedWriting = true;
                            for (int offset = 0; offset < data.length; offset += 1024) {
                                output.write(data, offset, Math.min(1024, data.length - offset));
                            }
                            output.flush();
                        }
                    } finally {
                        deadline.cancel(false);
                    }
                }
                call.resolve();
            } catch (Exception error) {
                String message = startedWriting ? "การส่งอาจไม่ครบ ตรวจใบพิมพ์ก่อนทำสำเนา" :
                    "เชื่อมต่อไม่สำเร็จ ตรวจเครื่องพิมพ์และ Bluetooth";
                call.reject(message, startedWriting ? "UNCERTAIN" : "NOT_SENT", error);
            }
        });
    }

    @PluginMethod
    public void exportFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mime", "application/octet-stream"))
            .putExtra(Intent.EXTRA_TITLE, call.getString("name", "sushi-oki-export"));
        startActivityForResult(call, intent, "fileChosen");
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null ||
            result.getData().getData() == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        io.execute(() -> {
            try (OutputStream file = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (file == null) throw new IOException("No output stream");
                file.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
            } catch (Exception error) {
                call.reject("บันทึกไฟล์ไม่สำเร็จ", error);
                return;
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }
}
