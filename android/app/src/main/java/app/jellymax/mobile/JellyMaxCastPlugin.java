package app.jellymax.mobile;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.mediarouter.media.MediaRouteSelector;
import androidx.mediarouter.media.MediaRouter;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.CastDevice;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;

/**
 * Google Cast : liste des appareils du réseau, connexion, envoi d'une vidéo et télécommande.
 * L'état de l'appareil est envoyé à l'application par les événements "devices" et "status".
 * Le SDK Cast s'utilise uniquement depuis le fil principal.
 */
@CapacitorPlugin(name = "JellyMaxCast")
public class JellyMaxCastPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private CastContext cast;
    private MediaRouter router;
    private MediaRouteSelector selector;
    private PluginCall pendingConnect;
    private RemoteMediaClient client;

    private final MediaRouter.Callback routerCallback = new MediaRouter.Callback() {
        @Override
        public void onRouteAdded(@NonNull MediaRouter r, @NonNull MediaRouter.RouteInfo route) {
            emitDevices();
        }

        @Override
        public void onRouteRemoved(@NonNull MediaRouter r, @NonNull MediaRouter.RouteInfo route) {
            emitDevices();
        }

        @Override
        public void onRouteChanged(@NonNull MediaRouter r, @NonNull MediaRouter.RouteInfo route) {
            emitDevices();
        }
    };

    private final RemoteMediaClient.Callback mediaCallback = new RemoteMediaClient.Callback() {
        @Override
        public void onStatusUpdated() {
            emitStatus();
        }
    };

    private final RemoteMediaClient.ProgressListener progressListener = (progress, duration) -> emitStatus();

    private final SessionManagerListener<CastSession> sessionListener = new SessionManagerListener<CastSession>() {
        @Override
        public void onSessionStarted(@NonNull CastSession session, @NonNull String sessionId) {
            attach(session);
            if (pendingConnect != null) {
                JSObject ret = new JSObject();
                ret.put("name", session.getCastDevice() != null ? session.getCastDevice().getFriendlyName() : "");
                pendingConnect.resolve(ret);
                pendingConnect = null;
            }
            emitStatus();
        }

        @Override
        public void onSessionResumed(@NonNull CastSession session, boolean wasSuspended) {
            attach(session);
            emitStatus();
        }

        @Override
        public void onSessionStartFailed(@NonNull CastSession session, int error) {
            if (pendingConnect != null) {
                pendingConnect.reject("Connexion impossible (" + error + ")");
                pendingConnect = null;
            }
        }

        @Override
        public void onSessionEnded(@NonNull CastSession session, int error) {
            detach();
            JSObject s = new JSObject();
            s.put("connected", false);
            notifyListeners("status", s);
        }

        @Override
        public void onSessionStarting(@NonNull CastSession session) {}

        @Override
        public void onSessionEnding(@NonNull CastSession session) {}

        @Override
        public void onSessionResuming(@NonNull CastSession session, @NonNull String sessionId) {}

        @Override
        public void onSessionResumeFailed(@NonNull CastSession session, int error) {}

        @Override
        public void onSessionSuspended(@NonNull CastSession session, int reason) {}
    };

    @Override
    public void load() {
        main.post(() -> {
            try {
                cast = CastContext.getSharedInstance(getContext());
                router = MediaRouter.getInstance(getContext());
                selector = cast.getMergedSelector();
                cast.getSessionManager().addSessionManagerListener(sessionListener, CastSession.class);
                CastSession current = cast.getSessionManager().getCurrentCastSession();
                if (current != null && current.isConnected()) attach(current);
            } catch (Exception e) {
                // Services Google Play absents ou trop anciens : pas de Cast sur cet appareil.
                cast = null;
            }
        });
    }

    private void attach(CastSession session) {
        RemoteMediaClient c = session.getRemoteMediaClient();
        if (c == client) return;
        detach();
        client = c;
        if (client != null) {
            client.registerCallback(mediaCallback);
            client.addProgressListener(progressListener, 1000);
        }
    }

    private void detach() {
        if (client != null) {
            client.unregisterCallback(mediaCallback);
            client.removeProgressListener(progressListener);
            client = null;
        }
    }

    private CastSession session() {
        return cast != null ? cast.getSessionManager().getCurrentCastSession() : null;
    }

    private void emitDevices() {
        if (router == null || selector == null) return;
        JSArray list = new JSArray();
        for (MediaRouter.RouteInfo r : router.getRoutes()) {
            if (r.isDefault() || !r.isEnabled() || !r.matchesSelector(selector)) continue;
            // Enceintes et barres de son exclues : il faut un écran pour lire une vidéo.
            CastDevice device = CastDevice.getFromBundle(r.getExtras());
            if (device != null && !device.hasCapability(CastDevice.CAPABILITY_VIDEO_OUT)) continue;
            JSObject d = new JSObject();
            d.put("id", r.getId());
            d.put("name", r.getName());
            d.put("model", r.getDescription() != null ? r.getDescription() : "");
            list.put(d);
        }
        JSObject ret = new JSObject();
        ret.put("devices", list);
        notifyListeners("devices", ret);
    }

    private void emitStatus() {
        CastSession s = session();
        JSObject st = new JSObject();
        st.put("connected", s != null && s.isConnected());
        if (s != null && s.getCastDevice() != null) st.put("name", s.getCastDevice().getFriendlyName());
        String state = "IDLE";
        String idleReason = null;
        double time = 0;
        double duration = 0;
        if (client != null && client.getMediaStatus() != null) {
            MediaStatus ms = client.getMediaStatus();
            switch (ms.getPlayerState()) {
                case MediaStatus.PLAYER_STATE_PLAYING:
                    state = "PLAYING";
                    break;
                case MediaStatus.PLAYER_STATE_PAUSED:
                    state = "PAUSED";
                    break;
                case MediaStatus.PLAYER_STATE_BUFFERING:
                case MediaStatus.PLAYER_STATE_LOADING:
                    state = "BUFFERING";
                    break;
                default:
                    state = "IDLE";
            }
            switch (ms.getIdleReason()) {
                case MediaStatus.IDLE_REASON_FINISHED:
                    idleReason = "FINISHED";
                    break;
                case MediaStatus.IDLE_REASON_ERROR:
                    idleReason = "ERROR";
                    break;
                case MediaStatus.IDLE_REASON_CANCELED:
                    idleReason = "CANCELLED";
                    break;
                case MediaStatus.IDLE_REASON_INTERRUPTED:
                    idleReason = "INTERRUPTED";
                    break;
                default:
                    idleReason = null;
            }
            time = client.getApproximateStreamPosition() / 1000.0;
            duration = client.getStreamDuration() / 1000.0;
        }
        st.put("state", state);
        st.put("idleReason", idleReason);
        st.put("time", time);
        st.put("duration", duration);
        st.put("volume", s != null ? s.getVolume() : 1);
        st.put("muted", s != null && s.isMute());
        notifyListeners("status", st);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        main.post(() -> {
            JSObject ret = new JSObject();
            ret.put("available", cast != null);
            CastSession s = session();
            if (s != null && s.isConnected() && s.getCastDevice() != null) ret.put("connected", s.getCastDevice().getFriendlyName());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        main.post(() -> {
            if (router != null && selector != null) {
                router.addCallback(selector, routerCallback, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN);
                emitDevices();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        main.post(() -> {
            if (router != null) router.removeCallback(routerCallback);
            call.resolve();
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        final String id = call.getString("id", "");
        main.post(() -> {
            if (router == null) {
                call.reject("Google Cast indisponible");
                return;
            }
            MediaRouter.RouteInfo target = null;
            for (MediaRouter.RouteInfo r : router.getRoutes()) if (r.getId().equals(id)) target = r;
            if (target == null) {
                call.reject("Appareil introuvable");
                return;
            }
            if (pendingConnect != null) pendingConnect.reject("Annulé");
            pendingConnect = call;
            router.selectRoute(target);
            main.postDelayed(() -> {
                if (pendingConnect == call) {
                    pendingConnect = null;
                    call.reject("L'appareil ne répond pas");
                }
            }, 30000);
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        final String url = call.getString("url", "");
        final String contentType = call.getString("contentType", "video/mp4");
        final String title = call.getString("title", "");
        final String subtitle = call.getString("subtitle", "");
        final String image = call.getString("image", "");
        final double start = call.getDouble("startTime", 0.0);
        final double duration = call.getDouble("duration", 0.0);
        main.post(() -> {
            CastSession s = session();
            if (s == null || !s.isConnected()) {
                call.reject("Aucun appareil Cast connecté");
                return;
            }
            attach(s);
            if (client == null) {
                call.reject("Aucun appareil Cast connecté");
                return;
            }
            boolean episode = subtitle != null && !subtitle.isEmpty();
            MediaMetadata md = new MediaMetadata(episode ? MediaMetadata.MEDIA_TYPE_TV_SHOW : MediaMetadata.MEDIA_TYPE_MOVIE);
            md.putString(MediaMetadata.KEY_TITLE, title);
            if (episode) {
                md.putString(MediaMetadata.KEY_SUBTITLE, subtitle);
                md.putString(MediaMetadata.KEY_SERIES_TITLE, title);
            }
            if (image != null && !image.isEmpty()) md.addImage(new WebImage(Uri.parse(image)));
            MediaInfo.Builder info = new MediaInfo.Builder(url)
                .setContentUrl(url)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                .setContentType(contentType)
                .setMetadata(md);
            if (duration > 0) info.setStreamDuration((long) (duration * 1000));
            MediaLoadRequestData req = new MediaLoadRequestData.Builder()
                .setMediaInfo(info.build())
                .setAutoplay(true)
                .setCurrentTime((long) (start * 1000))
                .build();
            client
                .load(req)
                .setResultCallback(result -> {
                    if (result.getStatus().isSuccess()) call.resolve();
                    else call.reject("Échec du chargement (" + result.getStatus().getStatusCode() + ")");
                });
        });
    }

    @PluginMethod
    public void control(PluginCall call) {
        final String type = call.getString("type", "");
        final double time = call.getDouble("time", 0.0);
        final double level = call.getDouble("level", 1.0);
        main.post(() -> {
            CastSession s = session();
            if (s == null) {
                call.resolve();
                return;
            }
            try {
                if ("VOLUME".equals(type)) s.setVolume(level);
                else if (client != null) {
                    if ("PLAY".equals(type)) client.play();
                    else if ("PAUSE".equals(type)) client.pause();
                    else if ("SEEK".equals(type)) client.seek(new MediaSeekOptions.Builder().setPosition((long) (time * 1000)).build());
                    else if ("STOP".equals(type)) client.stop();
                }
            } catch (Exception e) {
                /* appareil déconnecté entre-temps */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        main.post(() -> {
            if (cast != null) cast.getSessionManager().endCurrentSession(true);
            call.resolve();
        });
    }
}
