package com.pvzge.gardendless;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class SaveSnapshotTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("pvzge-snapshot-");
        Path data = root.resolve("data");
        Path db = data.resolve("app_webview/Default/Local Storage/leveldb/000003.log");
        Files.createDirectories(db.getParent());
        byte[] original = "玩家进度 WAL \u0000 backup-test".getBytes("UTF-8");
        Files.write(db, original);
        Path cache = data.resolve("app_webview/Default/Cache/data");
        Files.createDirectories(cache.getParent()); Files.write(cache, new byte[]{1});
        Path pref = data.resolve("shared_prefs/app_data.xml");
        Files.createDirectories(pref.getParent()); Files.write(pref, "settings".getBytes("UTF-8"));
        Path outside = root.resolve("outside"); Files.write(outside, "not-app-data".getBytes("UTF-8"));
        Files.createSymbolicLink(db.getParent().resolve("outside-link"), outside);
        File archive = SaveSnapshot.create(data.toFile(), root.resolve("snapshots").toFile(), 20004, 20006);
        Properties manifest = SaveSnapshot.verify(archive);
        if (!"2".equals(manifest.getProperty("entryCount"))) throw new AssertionError(manifest);
        if (!Arrays.equals(original, Files.readAllBytes(db))) throw new AssertionError("Source was altered");
        try (ZipFile zip = new ZipFile(archive)) {
            if (zip.getEntry("app_webview/Default/Cache/data") != null) throw new AssertionError("Cache copied");
            if (zip.getEntry("app_webview/Default/Local Storage/leveldb/outside-link") != null) throw new AssertionError("Symlink copied");
            byte[] copied = zip.getInputStream(zip.getEntry("app_webview/Default/Local Storage/leveldb/000003.log")).readAllBytes();
            if (!Arrays.equals(original, copied)) throw new AssertionError("Snapshot differs");
        }
        File second = SaveSnapshot.create(data.toFile(), root.resolve("snapshots").toFile(), 20004, 20006);
        if (second.equals(archive) || !archive.exists()) throw new AssertionError("Previous snapshot replaced");
        Path damaged = root.resolve("damaged.zip");
        try (ZipFile zip = new ZipFile(archive); ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(damaged))) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement(); out.putNextEntry(new ZipEntry(entry.getName()));
                if (entry.getName().endsWith("000003.log")) out.write("changed".getBytes("UTF-8"));
                else zip.getInputStream(entry).transferTo(out);
                out.closeEntry();
            }
        }
        try { SaveSnapshot.verify(damaged.toFile()); throw new AssertionError("Corruption accepted"); }
        catch (IOException expected) { /* expected */ }
        System.out.println("Snapshot preserved original data, excluded caches/symlinks, retained old snapshots, and rejected corruption");
    }
}
