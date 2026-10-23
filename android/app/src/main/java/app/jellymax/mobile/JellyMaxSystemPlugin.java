package app.jellymax.mobile;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import org.json.JSONException;

/**
 * Réglages système pendant la lecture d'une vidéo :
 * écran toujours allumé, plein écran immersif (barres système masquées) et orientation paysage.
 * Téléchargements hors connexion : gestionnaire de téléchargements d'Android (notification, reprise
 * en arrière-plan), fichiers dans le dossier de l'application, lus via un serveur local.
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

    private LocalFileServer fileServer;

    private File downloadDir() {
        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES), "JellyMax");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private DownloadManager manager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    /** Fichier situé dans le dossier des téléchargements de l'application, sinon null. */
    private File ownedFile(String path) {
        if (path == null) return null;
        try {
            File f = new File(path).getCanonicalFile();
            File dir = downloadDir().getCanonicalFile();
            return dir.equals(f.getParentFile()) ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "video");
        if (url == null) {
            call.reject("url manquante");
            return;
        }
        String safe = fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (safe.isEmpty()) safe = "video";
        if (safe.length() > 150) safe = safe.substring(0, 150);
        int dot = safe.lastIndexOf('.');
        String base = dot > 0 ? safe.substring(0, dot) : safe;
        String ext = dot > 0 ? safe.substring(dot) : "";
        File dir = downloadDir();
        File file = new File(dir, safe);
        for (int i = 2; file.exists(); i++) file = new File(dir, base + " (" + i + ")" + ext);
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle(call.getString("title", file.getName()));
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationUri(Uri.fromFile(file));
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            long id = manager().enqueue(req);
            JSObject ret = new JSObject();
            ret.put("id", String.valueOf(id));
            ret.put("file", file.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void downloadStatus(PluginCall call) {
        JSArray ids = call.getArray("ids");
        JSArray items = new JSArray();
        try {
            if (ids != null && ids.length() > 0) {
                long[] list = new long[ids.length()];
                for (int i = 0; i < ids.length(); i++) list[i] = Long.parseLong(ids.getString(i));
                try (Cursor c = manager().query(new DownloadManager.Query().setFilterById(list))) {
                    while (c != null && c.moveToNext()) {
                        JSObject o = new JSObject();
                        o.put("id", String.valueOf(c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))));
                        int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        String state = st == DownloadManager.STATUS_SUCCESSFUL ? "completed" : st == DownloadManager.STATUS_FAILED ? "failed" : "progressing";
                        o.put("state", state);
                        o.put("received", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
                        o.put("total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
                        o.put("reason", c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));
                        items.put(o);
                    }
                }
            }
        } catch (JSONException | IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void removeDownload(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            try {
                manager().remove(Long.parseLong(id));
            } catch (Exception e) {
                // déjà retiré
            }
        }
        File f = ownedFile(call.getString("file"));
        if (f != null && f.exists()) f.delete();
        call.resolve();
    }

    @PluginMethod
    public void downloadExists(PluginCall call) {
        File f = ownedFile(call.getString("file"));
        JSObject ret = new JSObject();
        ret.put("exists", f != null && f.isFile());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadUrl(PluginCall call) {
        File f = ownedFile(call.getString("file"));
        if (f == null || !f.isFile()) {
            call.reject("fichier introuvable");
            return;
        }
        try {
            if (fileServer == null) fileServer = new LocalFileServer(downloadDir());
            JSObject ret = new JSObject();
            ret.put("url", fileServer.urlFor(f));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
