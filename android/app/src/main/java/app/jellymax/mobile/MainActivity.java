package app.jellymax.mobile;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Écran de démarrage JellyMax (méduse sur fond noir), y compris avant Android 12.
        SplashScreen.installSplashScreen(this);
        registerPlugin(JellyMaxSystemPlugin.class);
        registerPlugin(JellyMaxCastPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
