// Copyright (C) 2026 Open Source Gardendless Contributors. GPL-3.0.
package com.pvzge.gardendless;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Read-only, verified snapshot taken before constructing any WebView. */
public final class SaveSnapshot {
    private SaveSnapshot() {}
    private static final Set<String> CACHES = new HashSet<>(Arrays.asList("Cache", "GPUCache", "Code Cache"));

    public static File create(File dataDirectory, File destination, int resourceVersion, int targetVersion) throws Exception {
        File data = dataDirectory.getCanonicalFile();
        if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException("Cannot create snapshot directory");
        String name = "before-" + targetVersion + "-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + ".zip";
        File partial = new File(destination, name + ".partial");
        File complete = new File(destination, name);
        Properties manifest = new Properties();
        manifest.setProperty("format", "gardendless-private-snapshot-1");
        manifest.setProperty("resourceVersion", Integer.toString(resourceVersion));
        manifest.setProperty("targetVersion", Integer.toString(targetVersion));
        int[] count = {0};
        try {
            try (FileOutputStream file = new FileOutputStream(partial);
                 ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(file))) {
                for (String folder : Arrays.asList("app_webview", "shared_prefs", "databases")) {
                    File root = new File(data, folder);
                    if (root.exists()) copy(data, root, zip, manifest, count);
                }
                manifest.setProperty("entryCount", Integer.toString(count[0]));
                zip.putNextEntry(new ZipEntry("manifest.properties"));
                manifest.store(zip, "Private snapshot; not an in-game JSON import file");
                zip.closeEntry();
                zip.finish();
                zip.flush();
                file.getFD().sync();
            }
            verify(partial);
            if (!partial.renameTo(complete)) throw new IOException("Cannot finalize snapshot");
            return complete;
        } catch (Exception failure) {
            partial.delete();
            throw failure;
        }
    }

    private static void copy(File data, File source, ZipOutputStream zip, Properties manifest, int[] count) throws Exception {
        // Never follow symlinks, and never leave the app's data directory.
        File canonical = source.getCanonicalFile();
        if (!canonical.equals(source.getAbsoluteFile()) || !canonical.toPath().startsWith(data.toPath())) return;
        if (source.isDirectory()) {
            if (CACHES.contains(source.getName())) return;
            File[] children = source.listFiles();
            if (children == null) throw new IOException("Cannot read snapshot source");
            Arrays.sort(children);
            for (File child : children) copy(data, child, zip, manifest, count);
            return;
        }
        if (!source.isFile()) return;
        long size = source.length(), modified = source.lastModified(), copied = 0;
        String relative = data.toPath().relativize(canonical.toPath()).toString().replace(File.separatorChar, '/');
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        zip.putNextEntry(new ZipEntry(relative));
        try (InputStream input = new BufferedInputStream(new FileInputStream(source))) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = input.read(buffer)) != -1) {
                zip.write(buffer, 0, n); digest.update(buffer, 0, n); copied += n;
            }
        }
        zip.closeEntry();
        if (copied != size || source.length() != size || source.lastModified() != modified) {
            throw new IOException("Snapshot source changed during copy");
        }
        manifest.setProperty("sha256." + relative, hex(digest.digest()));
        count[0]++;
    }

    public static Properties verify(File archive) throws Exception {
        try (ZipFile zip = new ZipFile(archive)) {
            ZipEntry metadata = zip.getEntry("manifest.properties");
            if (metadata == null) throw new IOException("Missing snapshot manifest");
            Properties manifest = new Properties();
            try (InputStream input = zip.getInputStream(metadata)) { manifest.load(input); }
            if (!"gardendless-private-snapshot-1".equals(manifest.getProperty("format"))) throw new IOException("Unknown snapshot format");
            Set<String> seen = new HashSet<>();
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (!seen.add(name) || name.startsWith("/") || Arrays.asList(name.split("/")).contains("..")) {
                    throw new IOException("Invalid snapshot entry");
                }
                if (name.equals("manifest.properties")) continue;
                String expected = manifest.getProperty("sha256." + name);
                if (expected == null || !expected.equals(sha256(zip.getInputStream(entry)))) {
                    throw new IOException("Snapshot verification failed");
                }
            }
            if (seen.size() - 1 != Integer.parseInt(manifest.getProperty("entryCount"))) throw new IOException("Incomplete snapshot");
            return manifest;
        }
    }

    public static String sha256(InputStream stream) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = stream) {
            byte[] buffer = new byte[65536]; int n;
            while ((n = input.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        return hex(digest.digest());
    }
    private static String hex(byte[] bytes) {
        char[] chars = "0123456789abcdef".toCharArray();
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) result.append(chars[(b & 255) >>> 4]).append(chars[b & 15]);
        return result.toString();
    }
}
