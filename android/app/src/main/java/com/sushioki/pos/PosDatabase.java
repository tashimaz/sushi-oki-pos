package com.sushioki.pos;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "PosDatabase")
public class PosDatabase extends Plugin {
    private SQLiteDatabase database;

    private SQLiteDatabase db() {
        if (database == null) {
            File file = getContext().getDatabasePath("sushi-oki.db");
            File directory = file.getParentFile();
            if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) {
                throw new IllegalStateException("Could not create database directory");
            }
            SQLiteDatabase.OpenParams options = new SQLiteDatabase.OpenParams.Builder()
                .addOpenFlags(SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
                .setSynchronousMode(SQLiteDatabase.SYNC_MODE_FULL)
                .build();
            database = SQLiteDatabase.openDatabase(file, options);
        }
        return database;
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            JSONObject queries = call.getObject("queries");
            JSObject result = new JSObject();
            SQLiteDatabase db = db();
            db.beginTransactionNonExclusive();
            try {
                Iterator<String> keys = queries.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    JSArray rows = new JSArray();
                    try (Cursor cursor = db.rawQuery(queries.getString(key), null)) {
                        String[] fields = cursor.getColumnNames();
                        while (cursor.moveToNext()) {
                            JSObject row = new JSObject();
                            for (int i = 0; i < fields.length; i++) row.put(fields[i], cursor.getString(i));
                            rows.put(row);
                        }
                    }
                    result.put(key, rows);
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("อ่านฐานข้อมูลไม่สำเร็จ", "SQL_READ", error);
        }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        try {
            JSONArray statements = call.getArray("statements");
            SQLiteDatabase db = db();
            db.beginTransactionNonExclusive();
            try {
                for (int i = 0; i < statements.length(); i++) {
                    JSONObject spec = statements.getJSONObject(i);
                    String sql = spec.getString("sql");
                    JSONArray args = spec.optJSONArray("args");
                    if (spec.optBoolean("changed")) {
                        try (SQLiteStatement statement = db.compileStatement(sql)) {
                            if (args != null) {
                                for (int j = 0; j < args.length(); j++) {
                                    if (args.isNull(j)) statement.bindNull(j + 1);
                                    else statement.bindString(j + 1, args.getString(j));
                                }
                            }
                            if (statement.executeUpdateDelete() != 1) throw new IllegalStateException("revision changed");
                        }
                    } else {
                        Object[] params = new Object[args == null ? 0 : args.length()];
                        for (int j = 0; j < params.length; j++) params[j] = args.isNull(j) ? null : args.get(j);
                        db.execSQL(sql, params);
                    }
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("บันทึกฐานข้อมูลไม่สำเร็จ", "SQL_WRITE", error);
        }
    }
}
