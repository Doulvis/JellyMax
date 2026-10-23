package app.jellymax.mobile;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Mini serveur HTTP local (127.0.0.1 uniquement) qui sert les vidéos téléchargées au lecteur de l'application.
 * Le serveur de fichiers intégré à Capacitor ne gère pas correctement les requêtes partielles (Range),
 * indispensables pour avancer dans une vidéo et pour les fichiers de plus de 2 Go.
 * Un jeton aléatoire dans l'adresse empêche les autres applications de lire les fichiers.
 */
class LocalFileServer {

    private final File root;
    private final String token;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket server;

    LocalFileServer(File root) {
        this.root = root;
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        this.token = sb.toString();
    }

    synchronized String urlFor(File file) throws IOException {
        if (server == null || server.isClosed()) start();
        String name = java.net.URLEncoder.encode(file.getName(), "UTF-8").replace("+", "%20");
        return "http://127.0.0.1:" + server.getLocalPort() + "/" + token + "/" + name;
    }

    private void start() throws IOException {
        server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket socket = server.accept();
                    pool.execute(() -> handle(socket));
                } catch (IOException e) {
                    // serveur fermé
                }
            }
        }, "jellymax-local-files");
        t.setDaemon(true);
        t.start();
    }

    private void handle(Socket socket) {
        try (Socket s = socket) {
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = in.readLine();
            if (requestLine == null) return;
            String range = null;
            String line;
            while ((line = in.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("range")) range = line.substring(colon + 1).trim();
            }
            String[] parts = requestLine.split(" ");
            OutputStream out = s.getOutputStream();
            if (parts.length < 2) {
                status(out, "400 Bad Request");
                return;
            }
            boolean head = parts[0].equals("HEAD");
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            String prefix = "/" + token + "/";
            if (!path.startsWith(prefix)) {
                status(out, "403 Forbidden");
                return;
            }
            String name = URLDecoder.decode(path.substring(prefix.length()), "UTF-8");
            File file = new File(root, name);
            if (name.contains("/") || name.contains("\\") || !file.isFile()) {
                status(out, "404 Not Found");
                return;
            }
            serve(out, file, range, head);
        } catch (IOException e) {
            // lecteur fermé ou déplacement dans la vidéo : connexion abandonnée
        }
    }

    private static void status(OutputStream out, String status) throws IOException {
        out.write(("HTTP/1.1 " + status + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static void serve(OutputStream out, File file, String range, boolean head) throws IOException {
        long length = file.length();
        long start = 0;
        long end = length - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            try {
                if (dash == 0) {
                    long suffix = Long.parseLong(spec.substring(1));
                    start = Math.max(0, length - suffix);
                } else if (dash > 0) {
                    start = Long.parseLong(spec.substring(0, dash));
                    if (dash < spec.length() - 1) end = Math.min(end, Long.parseLong(spec.substring(dash + 1)));
                }
                partial = true;
            } catch (NumberFormatException e) {
                partial = false;
            }
            if (partial && start >= length) {
                out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + length
                        + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                return;
            }
        }
        long count = end - start + 1;
        StringBuilder h = new StringBuilder();
        h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        h.append("Content-Type: ").append(mimeType(file.getName())).append("\r\n");
        h.append("Content-Length: ").append(count).append("\r\n");
        h.append("Accept-Ranges: bytes\r\n");
        if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(length).append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (head) {
            out.flush();
            return;
        }
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            raf.seek(start);
            byte[] buf = new byte[64 * 1024];
            long left = count;
            while (left > 0) {
                int n = raf.read(buf, 0, (int) Math.min(buf.length, left));
                if (n < 0) break;
                out.write(buf, 0, n);
                left -= n;
            }
        }
        out.flush();
    }

    private static String mimeType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".ts") || n.endsWith(".m2ts")) return "video/mp2t";
        if (n.endsWith(".avi")) return "video/x-msvideo";
        return "application/octet-stream";
    }
}
