//! System font discovery for the text tool. Scans the usual font folders, reads the
//! family names with ttf-parser (TrueType, OpenType/CFF, TTC/OTC collections) and hands
//! single-face font bytes to the webview. Collections are split into a standalone
//! sfnt so opentype.js (which cannot read collections) can parse them.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Debug)]
struct Face {
    family: String,
    path: PathBuf,
    index: u32,
    weight: u16,
    italic: bool,
}

#[derive(serde::Serialize)]
pub struct FontFamily {
    family: String,
    weights: Vec<u16>,
}

static FACES: OnceLock<Vec<Face>> = OnceLock::new();

fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    {
        dirs.push("/System/Library/Fonts".into());
        dirs.push("/Library/Fonts".into());
        if let Some(h) = &home {
            dirs.push(h.join("Library/Fonts"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| "C:\\Windows".into());
        dirs.push(windir.join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft\\Windows\\Fonts"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push("/usr/share/fonts".into());
        dirs.push("/usr/local/share/fonts".into());
        if let Some(h) = &home {
            dirs.push(h.join(".local/share/fonts"));
            dirs.push(h.join(".fonts"));
        }
    }
    let _ = home;
    dirs
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() && depth < 4 {
            walk(&p, out, depth + 1);
        } else if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
            if matches!(ext.to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc" | "otc") {
                out.push(p);
            }
        }
    }
}

fn family_name(face: &ttf_parser::Face) -> Option<String> {
    use ttf_parser::name_id;
    let names = face.names();
    let pick = |id: u16| {
        names
            .into_iter()
            .filter(|n| n.name_id == id && n.is_unicode())
            .find_map(|n| n.to_string())
    };
    pick(name_id::TYPOGRAPHIC_FAMILY).or_else(|| pick(name_id::FAMILY))
}

fn scan() -> Vec<Face> {
    let mut files = Vec::new();
    for d in font_dirs() {
        walk(&d, &mut files, 0);
    }
    let mut faces = Vec::new();
    for path in files {
        let Ok(data) = std::fs::read(&path) else { continue };
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        for index in 0..count {
            let Ok(face) = ttf_parser::Face::parse(&data, index) else { continue };
            let Some(family) = family_name(&face) else { continue };
            // Hidden system faces (".SF NS …") are not meant for users.
            if family.starts_with('.') {
                continue;
            }
            faces.push(Face { family, path: path.clone(), index, weight: face.weight().to_number(), italic: face.is_italic() });
        }
    }
    faces
}

fn faces() -> &'static Vec<Face> {
    FACES.get_or_init(scan)
}

/// Installed font families (upright faces only), alphabetical, with their weights.
#[tauri::command]
pub async fn fonts_list() -> Vec<FontFamily> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut map: BTreeMap<String, Vec<u16>> = BTreeMap::new();
        for f in faces().iter().filter(|f| !f.italic) {
            let w = map.entry(f.family.clone()).or_default();
            if !w.contains(&f.weight) {
                w.push(f.weight);
            }
        }
        map.into_iter()
            .map(|(family, mut weights)| {
                weights.sort_unstable();
                FontFamily { family, weights }
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default()
}

/// Copies one face out of a collection into a standalone sfnt.
fn extract_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    let be32 = |o: usize| -> Option<u32> { Some(u32::from_be_bytes(data.get(o..o + 4)?.try_into().ok()?)) };
    let be16 = |o: usize| -> Option<u16> { Some(u16::from_be_bytes(data.get(o..o + 2)?.try_into().ok()?)) };
    if data.get(0..4)? != b"ttcf" {
        return Some(data.to_vec());
    }
    let start = be32(12 + 4 * index as usize)? as usize;
    let num = be16(start + 4)? as usize;
    let header_len = 12 + 16 * num;
    let mut out = Vec::with_capacity(header_len);
    out.extend_from_slice(data.get(start..start + 12)?);
    let mut tables = Vec::new();
    let mut offset = header_len;
    for i in 0..num {
        let rec = start + 12 + 16 * i;
        let (tag, sum, off, len) = (be32(rec)?, be32(rec + 4)?, be32(rec + 8)? as usize, be32(rec + 12)? as usize);
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&sum.to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(len as u32).to_be_bytes());
        tables.push((off, len));
        offset += (len + 3) & !3;
    }
    for (off, len) in tables {
        out.extend_from_slice(data.get(off..off + len)?);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    Some(out)
}

/// Bytes of the family's face closest to `weight` (upright preferred).
#[tauri::command]
pub async fn font_bytes(family: String, weight: u16) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let face = faces()
            .iter()
            .filter(|f| f.family == family)
            .min_by_key(|f| (f.italic as u32 * 10_000) + (f.weight as i32 - weight as i32).unsigned_abs())
            .cloned()
            .ok_or_else(|| format!("Schrift „{family}“ ist nicht installiert."))?;
        let data = std::fs::read(&face.path).map_err(|e| e.to_string())?;
        let bytes = extract_face(&data, face.index).ok_or("Schriftdatei ist beschädigt.")?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_and_extracts_collection_faces() {
        let all = faces();
        assert!(!all.is_empty(), "no system fonts found");
        // Every face taken out of a collection must parse on its own.
        let ttc: Vec<&Face> = all.iter().filter(|f| f.path.extension().map_or(false, |e| e.eq_ignore_ascii_case("ttc"))).take(20).collect();
        for f in &ttc {
            let data = std::fs::read(&f.path).unwrap();
            let one = extract_face(&data, f.index).expect("extract");
            let face = ttf_parser::Face::parse(&one, 0).expect("standalone face parses");
            assert_eq!(family_name(&face).as_deref(), Some(f.family.as_str()));
        }
        if let Some(dir) = std::env::var_os("FONT_DUMP") {
            if let Some(f) = ttc.iter().find(|f| f.index > 0) {
                let data = std::fs::read(&f.path).unwrap();
                std::fs::write(PathBuf::from(dir).join("extracted.ttf"), extract_face(&data, f.index).unwrap()).unwrap();
                println!("dumped {} #{} ({})", f.family, f.index, f.path.display());
            }
        }
        println!("{} faces, {} from collections", all.len(), ttc.len());
    }
}
