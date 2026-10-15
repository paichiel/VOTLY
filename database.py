import sqlite3
import os
import json
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from crypto_service import CryptoService

DB_PATH = "votly.db"
UPLOADS_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        pin_hash TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        auto_lock_minutes INTEGER DEFAULT 5
    )
    """)

    # Documents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        document_type TEXT NOT NULL,
        document_number TEXT,
        country TEXT,
        issued_date TEXT,
        expires_date TEXT,
        notes TEXT,
        tags TEXT,
        file_path TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        is_client_encrypted INTEGER DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Secure shares table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        pin_hash TEXT,
        expires_at TEXT,
        view_count INTEGER DEFAULT 0,
        max_views INTEGER DEFAULT 10,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Activity log table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        document_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    conn.commit()
    conn.close()

def seed_sample_data():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM users WHERE email = ?", ("ada.okafor@email.com",))
    existing_user = cursor.fetchone()
    if existing_user:
        conn.close()
        return existing_user["id"]

    now = datetime.now().isoformat()
    pwd_hash = generate_password_hash("Password123!")
    pin_hash = generate_password_hash("1234")

    cursor.execute("""
    INSERT INTO users (email, full_name, password_hash, pin_hash, avatar_url, created_at, auto_lock_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, ("ada.okafor@email.com", "Ada Okafor", pwd_hash, pin_hash, "/static/assets/ada_header_avatar.png", now, 5))

    user_id = cursor.lastrowid

    # Create dummy encrypted files for the sample docs
    sample_files = [
        {
            "title": "International Passport",
            "category": "Travel",
            "document_type": "Passport",
            "document_number": "A09823411",
            "country": "Nigeria",
            "issued_date": "2020-01-12",
            "expires_date": "2030-01-11",
            "notes": "Federal Republic of Nigeria 32-Page Machine Readable Electronic Passport.",
            "tags": "travel, passport, international, visa",
            "filename": "nigerian_passport_ada.png",
            "source_asset": "static/assets/nigeria_passport_authentic.png",
            "mime_type": "image/png",
            "is_favorite": 1
        },
        {
            "title": "Passport Photo",
            "category": "Personal",
            "document_type": "Identity Photo",
            "document_number": "PHOTO-2020-01",
            "country": "Nigeria",
            "issued_date": "2020-01-12",
            "expires_date": "2030-01-12",
            "notes": "Biometric compliant white-background passport headshot photo.",
            "tags": "photo, biometric, visa",
            "filename": "passport_photo.png",
            "source_asset": "static/assets/thumb_photo.png",
            "mime_type": "image/png",
            "is_favorite": 1
        },
        {
            "title": "Visa Document",
            "category": "Travel",
            "document_type": "Visa",
            "document_number": "V-GB-8849201",
            "country": "United Kingdom",
            "issued_date": "2023-06-18",
            "expires_date": "2025-06-18",
            "notes": "Multiple Entry Standard Visitor Visa sticker with biometric stamp.",
            "tags": "visa, uk, travel, entry",
            "filename": "uk_visa_sticker.png",
            "source_asset": "static/assets/thumb_visa.png",
            "mime_type": "image/png",
            "is_favorite": 0
        },
        {
            "title": "National ID Slip (NIN)",
            "category": "Identity",
            "document_type": "National ID",
            "document_number": "NIN-8934-2910-4491",
            "country": "Nigeria",
            "issued_date": "2021-04-15",
            "expires_date": "2031-04-14",
            "notes": "National Identity Management Commission (NIMC) Digital ID Verification Slip.",
            "tags": "nin, identity, government, nimc",
            "filename": "national_id_nin.png",
            "source_asset": "static/assets/nigeria_nin_front_crop.png",
            "mime_type": "image/png",
            "is_favorite": 1
        },
        {
            "title": "Driver's License",
            "category": "Identity",
            "document_type": "Driver License",
            "document_number": "DL-FRSC-89210-LAG",
            "country": "Nigeria",
            "issued_date": "2022-06-10",
            "expires_date": "2027-06-09",
            "notes": "Federal Road Safety Corps Class B motor vehicle license.",
            "tags": "license, driving, id, frsc",
            "filename": "drivers_license.png",
            "source_asset": None,
            "mime_type": "image/png",
            "is_favorite": 0
        },
        {
            "title": "Cobalt Premier Card",
            "category": "Banking",
            "document_type": "Bank Card",
            "document_number": "5399 2810 9921 8829",
            "country": "Nigeria",
            "issued_date": "2023-03-01",
            "expires_date": "2027-03-31",
            "notes": "Platinum World Debit Card with chip & PIN security.",
            "tags": "bank, mastercard, debit, finance",
            "filename": "cobalt_premier_card.png",
            "source_asset": None,
            "mime_type": "image/png",
            "is_favorite": 0
        },
        {
            "title": "Bank Statement (Q3)",
            "category": "Banking",
            "document_type": "Bank Statement",
            "document_number": "STMT-2026-Q3-0091",
            "country": "Nigeria",
            "issued_date": "2026-09-30",
            "expires_date": "2027-09-30",
            "notes": "Official stamped e-statement with cryptographic verification seal.",
            "tags": "bank, statement, financial, proof of funds",
            "filename": "bank_statement_q3.pdf",
            "source_asset": None,
            "mime_type": "application/pdf",
            "is_favorite": 0
        },
        {
            "title": "University Degree Certificate",
            "category": "Education",
            "document_type": "Certificate",
            "document_number": "DEG-2019-UNILAG-08",
            "country": "Nigeria",
            "issued_date": "2019-11-20",
            "expires_date": None,
            "notes": "Bachelor of Science in Computer Science with Honors.",
            "tags": "degree, education, certificate, university",
            "filename": "unilag_degree_cert.pdf",
            "source_asset": None,
            "mime_type": "application/pdf",
            "is_favorite": 0
        },
        {
            "title": "Employment Contract",
            "category": "Personal",
            "document_type": "Contract",
            "document_number": "EMP-CONTRACT-2024",
            "country": "United Kingdom",
            "issued_date": "2024-01-15",
            "expires_date": "2027-01-15",
            "notes": "Senior Solutions Architect Agreement and Non-Disclosure.",
            "tags": "contract, work, legal, employment",
            "filename": "employment_contract.pdf",
            "source_asset": None,
            "mime_type": "application/pdf",
            "is_favorite": 0
        },
        {
            "title": "International Vaccination Card",
            "category": "Health",
            "document_type": "Medical Record",
            "document_number": "WHO-YELLOW-99120",
            "country": "International",
            "issued_date": "2021-09-05",
            "expires_date": "2031-09-04",
            "notes": "WHO Yellow Card with Yellow Fever and Meningitis certifications.",
            "tags": "health, vaccine, who, yellow card",
            "filename": "who_yellow_card.pdf",
            "source_asset": None,
            "mime_type": "application/pdf",
            "is_favorite": 0
        }
    ]

    for item in sample_files:
        enc_filename = f"enc_{CryptoService.generate_secure_token(12)}.votly"
        enc_path = os.path.join(UPLOADS_DIR, enc_filename)

        raw_bytes = None
        if item["source_asset"] and os.path.exists(item["source_asset"]):
            with open(item["source_asset"], "rb") as f:
                raw_bytes = f.read()
        else:
            # Generate placeholder document content
            content_text = f"VOTLY SECURE DOCUMENT\nTitle: {item['title']}\nType: {item['document_type']}\nNumber: {item['document_number']}\nIssued: {item['issued_date']}\nExpires: {item['expires_date']}\nNotes: {item['notes']}\nSecurity: AES-256-GCM Encrypted Blob"
            raw_bytes = content_text.encode("utf-8")

        CryptoService.encrypt_file(raw_bytes, enc_path)
        sha256_hash = CryptoService.compute_sha256(raw_bytes)
        file_size = len(raw_bytes)

        cursor.execute("""
        INSERT INTO documents (
            user_id, title, category, document_type, document_number, country,
            issued_date, expires_date, notes, tags, file_path, original_filename,
            file_size, mime_type, sha256_hash, is_favorite, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, item["title"], item["category"], item["document_type"],
            item["document_number"], item["country"], item["issued_date"],
            item["expires_date"], item["notes"], item["tags"], enc_path,
            item["filename"], file_size, item["mime_type"], sha256_hash,
            item["is_favorite"], now, now
        ))

        doc_id = cursor.lastrowid
        cursor.execute("""
        INSERT INTO activity_logs (user_id, document_id, action, details, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """, (user_id, doc_id, "UPLOAD", f"Document '{item['title']}' encrypted and stored.", now))

    conn.commit()
    conn.close()
    return user_id
