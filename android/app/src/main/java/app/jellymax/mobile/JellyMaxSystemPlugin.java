package app.jellymax.mobile;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Réglages système pendant la lecture d'une vidéo :
 * écran toujours allumé, plein écran immersif (barres système masquées) et orientation paysage.
 */
@CapacitorPlugin(name = "JellyMaxSystem")
public class JellyMaxSystemPlugin extends Plugin {

    @PluginMethod
    public void setPlayback(PluginCall call) {
        final boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            if (active) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                bars.show(WindowInsetsCompat.Type.systemBars());
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }
            call.resolve();
        });
    }
}
