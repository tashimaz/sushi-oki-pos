package com.sushioki.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(PosDatabase.class);
        registerPlugin(PosHardware.class);
        super.onCreate(state);
    }
}
