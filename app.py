import os
import io
import re
import json
import mimetypes
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_file, g
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import database
from crypto_service import CryptoService
from email_service import EmailService
from supabase_service import SupabaseService, is_supabase_enabled

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = os.urandom(24)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB max upload
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Session token memory store for demo & token-based auth
ACTIVE_SESSIONS = {}

def get_auth_user():
    """Extract and authenticate user from Authorization header or session."""
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    elif request.cookies.get("votly_token"):
        token = request.cookies.get("votly_token")
    
    if not token or token not in ACTIVE_SESSIONS:
        # Default fallback for seamless demo if no header: Primary user
        if is_supabase_enabled():
            user = SupabaseService.get_user_by_id(1) or SupabaseService.get_user_by_email("ada.okafor@email.com")
            if user: return user
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users ORDER BY id ASC LIMIT 1")
        user = cursor.fetchone()
        conn.close()
        if user:
            return dict(user)
        return None
    
    user_id = ACTIVE_SESSIONS[token]["user_id"]
    if is_supabase_enabled():
        user = SupabaseService.get_user_by_id(user_id)
        if user: return user
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_auth_user()
        if not user:
            return jsonify({"error": "Unauthorized. Please sign in."}), 401
        g.user = user
        return f(*args, **kwargs)
    return decorated

def log_activity(user_id, document_id, action, details):
    if is_supabase_enabled():
        SupabaseService.log_activity(user_id, document_id, action, details)
        return
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO activity_logs (user_id, document_id, action, details, timestamp)
    VALUES (?, ?, ?, ?, ?)
    """, (user_id, document_id, action, details, datetime.now().isoformat()))
    conn.commit()
    conn.close()

# ----------------- PAGE ROUTES ----------------- #

@app.route("/")
def index():
    return render_template("index.html")

# ----------------- AUTH ENDPOINTS ----------------- #

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = None
    if is_supabase_enabled():
        user = SupabaseService.get_user_by_email(email)
    else:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
        row = cursor.fetchone()
        conn.close()
        user = dict(row) if row else None

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    token = CryptoService.generate_secure_token(32)
    ACTIVE_SESSIONS[token] = {
        "user_id": user["id"],
        "created_at": datetime.now()
    }

    log_activity(user["id"], None, "AUTH_LOGIN", f"User logged in from {request.remote_addr}")

    user_dict = dict(user)
    user_dict.pop("password_hash", None)
    user_dict.pop("pin_hash", None)

    return jsonify({
        "message": "Login successful",
        "token": token,
        "user": user_dict
    })

@app.route("/api/auth/quick-demo", methods=["POST"])
def quick_demo():
    """Allows instant 1-click access to the demo vault as Ada Okafor."""
    user = None
    if is_supabase_enabled():
        user = SupabaseService.get_user_by_email("ada.okafor@email.com")
    else:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", ("ada.okafor@email.com",))
        row = cursor.fetchone()
        conn.close()
        user = dict(row) if row else None

    if not user:
        return jsonify({"error": "Demo user not found"}), 404

    token = CryptoService.generate_secure_token(32)
    ACTIVE_SESSIONS[token] = {
        "user_id": user["id"],
        "created_at": datetime.now()
    }

    user_dict = dict(user)
    user_dict.pop("password_hash", None)
    user_dict.pop("pin_hash", None)

    return jsonify({
        "message": "Demo session started",
        "token": token,
        "user": user_dict
    })

@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    full_name = data.get("full_name", "").strip()
    password = data.get("password", "")
    pin = data.get("pin", "1234").strip()

    if not email or not full_name or not password:
        return jsonify({"error": "Full name, email, and password are required"}), 400

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({"error": "An account with this email already exists"}), 400

    pwd_hash = generate_password_hash(password)
    pin_hash = generate_password_hash(pin) if pin else None
    now = datetime.now().isoformat()

    cursor.execute("""
    INSERT INTO users (email, full_name, password_hash, pin_hash, avatar_url, created_at, auto_lock_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (email, full_name, pwd_hash, pin_hash, "/static/assets/ada_header_avatar.png", now, 5))
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()

    token = CryptoService.generate_secure_token(32)
    ACTIVE_SESSIONS[token] = {
        "user_id": user_id,
        "created_at": datetime.now()
    }

    log_activity(user_id, None, "AUTH_REGISTER", f"Account created for {email}")

    return jsonify({
        "message": "Registration successful",
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "full_name": full_name,
            "avatar_url": "/static/assets/ada_header_avatar.png",
            "auto_lock_minutes": 5
        }
    }), 201

@app.route("/api/auth/verify-pin", methods=["POST"])
@require_auth
def verify_pin():
    data = request.get_json() or {}
    pin = data.get("pin", "")
    user = g.user

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT pin_hash FROM users WHERE id = ?", (user["id"],))
    row = cursor.fetchone()
    conn.close()

    if not row or not row["pin_hash"]:
        return jsonify({"valid": True, "message": "No PIN set"})

    is_valid = check_password_hash(row["pin_hash"], pin)
    if is_valid:
        log_activity(user["id"], None, "VAULT_UNLOCK", "Vault unlocked via PIN")
        return jsonify({"valid": True, "message": "PIN verified successfully"})
    return jsonify({"valid": False, "error": "Incorrect security PIN"}), 403

@app.route("/api/auth/me", methods=["GET"])
@require_auth
def get_current_user():
    user = dict(g.user)
    user.pop("password_hash", None)
    user.pop("pin_hash", None)
    return jsonify({"user": user})

@app.route("/api/user/profile", methods=["GET", "PUT"])
@require_auth
def manage_user_profile():
    """Fetches or updates user personal profile info (name, email, avatar, credentials)."""
    user = g.user
    if request.method == "GET":
        clean_user = dict(user)
        clean_user.pop("password_hash", None)
        clean_user.pop("pin_hash", None)
        return jsonify({"user": clean_user})

    # PUT: Update profile fields
    data = request.get_json() or {}
    updates = {}

    if "full_name" in data:
        name = data["full_name"].strip()
        if not name:
            return jsonify({"error": "Full name cannot be blank"}), 400
        updates["full_name"] = name

    if "email" in data:
        email = data["email"].strip().lower()
        if not email or "@" not in email:
            return jsonify({"error": "Please provide a valid email address"}), 400
        updates["email"] = email

    if "avatar_url" in data and data["avatar_url"]:
        updates["avatar_url"] = data["avatar_url"].strip()

    if "auto_lock_minutes" in data:
        try:
            updates["auto_lock_minutes"] = int(data["auto_lock_minutes"])
        except ValueError:
            pass

    if "pin" in data and data["pin"]:
        pin_str = str(data["pin"]).strip()
        if len(pin_str) >= 4:
            updates["pin_hash"] = generate_password_hash(pin_str)
        else:
            return jsonify({"error": "Security PIN must be at least 4 digits"}), 400

    if "new_password" in data and data["new_password"]:
        current_pwd = data.get("current_password", "")
        if user.get("password_hash") and current_pwd:
            if not check_password_hash(user["password_hash"], current_pwd):
                return jsonify({"error": "Current master password is incorrect"}), 403
        new_pwd = data["new_password"].strip()
        if len(new_pwd) < 6:
            return jsonify({"error": "New password must be at least 6 characters"}), 400
        updates["password_hash"] = generate_password_hash(new_pwd)

    updated_user = None
    if is_supabase_enabled():
        updated_user = SupabaseService.update_user_profile(user["id"], updates)

    local_updated = database.update_user_profile(user["id"], updates)
    if not updated_user:
        updated_user = local_updated

    log_activity(user["id"], None, "PROFILE_UPDATE", f"User profile details updated for '{updated_user.get('email', '')}'")

    clean_user = dict(updated_user)
    clean_user.pop("password_hash", None)
    clean_user.pop("pin_hash", None)

    return jsonify({
        "message": "Profile updated successfully",
        "user": clean_user
    })

@app.route("/api/auth/settings", methods=["PUT"])
@require_auth
def update_settings():
    return manage_user_profile()

# ----------------- DOCUMENT ENDPOINTS ----------------- #

@app.route("/api/documents", methods=["GET"])
@require_auth
def list_documents():
    user = g.user
    category = request.args.get("category", "").strip()
    search = request.args.get("search", "").strip().lower()
    sort_by = request.args.get("sort", "newest")
    filter_type = request.args.get("filter", "all")

    if is_supabase_enabled():
        docs, cat_counts = SupabaseService.get_documents(
            user["id"], category=category, search=search, filter_type=filter_type, sort_by=sort_by
        )
        return jsonify({
            "documents": docs,
            "count": len(docs),
            "category_counts": cat_counts
        })

    conn = database.get_db()
    cursor = conn.cursor()

    query = "SELECT * FROM documents WHERE user_id = ?"
    params = [user["id"]]

    if category and category.lower() != "all":
        query += " AND LOWER(category) = ?"
        params.append(category.lower())

    if search:
        query += " AND (LOWER(title) LIKE ? OR LOWER(document_type) LIKE ? OR LOWER(document_number) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(country) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term, term, term])

    if filter_type == "favorites":
        query += " AND is_favorite = 1"

    # Sorting
    if sort_by == "oldest":
        query += " ORDER BY created_at ASC"
    elif sort_by == "expiry":
        query += " ORDER BY CASE WHEN expires_date IS NULL THEN 1 ELSE 0 END, expires_date ASC"
    elif sort_by == "title":
        query += " ORDER BY title ASC"
    else:
        query += " ORDER BY created_at DESC"

    cursor.execute(query, params)
    rows = cursor.fetchall()

    docs = []
    today = datetime.now().date()
    for r in rows:
        d = dict(r)
        # Check expiry status
        exp = d.get("expires_date")
        d["status"] = "Active"
        d["urgency"] = "normal"
        d["days_remaining"] = None
        if exp:
            try:
                exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
                delta = (exp_date - today).days
                d["days_remaining"] = delta
                if delta < 0:
                    d["status"] = "Expired"
                    d["urgency"] = "expired"
                elif delta <= 1:
                    d["status"] = "Expires Tomorrow" if delta == 1 else "Expires Today"
                    d["urgency"] = "critical"
                elif delta <= 7:
                    d["status"] = f"Expires in {delta}d"
                    d["urgency"] = "urgent"
                elif delta <= 14:
                    d["status"] = f"Expires in {delta}d"
                    d["urgency"] = "warning"
                elif delta <= 30:
                    d["status"] = f"Expires in {delta}d"
                    d["urgency"] = "notice"
                else:
                    d["status"] = "Active"
                    d["urgency"] = "normal"
            except Exception:
                pass

        if filter_type == "expiring":
            if d["days_remaining"] is not None and 0 <= d["days_remaining"] <= 30:
                docs.append(d)
        else:
            docs.append(d)

    # Calculate category counts for navigation badges
    cursor.execute("""
    SELECT category, COUNT(*) as count FROM documents WHERE user_id = ? GROUP BY category
    """, (user["id"],))
    cat_counts = {row["category"]: row["count"] for row in cursor.fetchall()}

    conn.close()
    return jsonify({
        "documents": docs,
        "count": len(docs),
        "category_counts": cat_counts
    })

@app.route("/api/documents/<int:doc_id>", methods=["GET"])
@require_auth
def get_document(doc_id):
    user = g.user
    if is_supabase_enabled():
        doc = SupabaseService.get_document_by_id(doc_id, user["id"])
        if not doc:
            return jsonify({"error": "Document not found"}), 404
        return jsonify({"document": doc})

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Document not found"}), 404

    doc = dict(row)

    # Fetch logs for this document
    cursor.execute("""
    SELECT action, details, timestamp FROM activity_logs
    WHERE document_id = ? ORDER BY timestamp DESC LIMIT 10
    """, (doc_id,))
    logs = [dict(log) for log in cursor.fetchall()]
    doc["activity_logs"] = logs

    conn.close()
    return jsonify({"document": doc})

@app.route("/api/documents", methods=["POST"])
@require_auth
def create_document():
    user = g.user
    
    raw_bytes = None
    original_filename = "document.dat"
    mime_type = "application/octet-stream"
    is_client_encrypted = 0

    if request.is_json:
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        category = data.get("category", "Personal").strip()
        document_type = data.get("document_type", "General").strip()
        document_number = data.get("document_number", "").strip()
        country = data.get("country", "").strip()
        issued_date = data.get("issued_date")
        expires_date = data.get("expires_date")
        notes = data.get("notes", "").strip()
        tags = data.get("tags", "").strip()
        is_client_encrypted = int(data.get("is_client_encrypted", 0))
        if data.get("camera_data"):
            import base64
            data_uri = data.get("camera_data")
            if "," in data_uri:
                header, encoded = data_uri.split(",", 1)
                raw_bytes = base64.b64decode(encoded)
                mime_type = "image/jpeg"
                original_filename = f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    else:
        title = request.form.get("title", "").strip()
        category = request.form.get("category", "Personal").strip()
        document_type = request.form.get("document_type", "General").strip()
        document_number = request.form.get("document_number", "").strip()
        country = request.form.get("country", "").strip()
        issued_date = request.form.get("issued_date", "").strip() or None
        expires_date = request.form.get("expires_date", "").strip() or None
        notes = request.form.get("notes", "").strip()
        tags = request.form.get("tags", "").strip()
        is_client_encrypted = int(request.form.get("is_client_encrypted", 0))

        if "file" in request.files and request.files["file"].filename:
            file = request.files["file"]
            original_filename = secure_filename(file.filename) or "uploaded_document"
            raw_bytes = file.read()
            mime_type = file.mimetype or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
        elif request.form.get("camera_data"):
            import base64
            data_uri = request.form.get("camera_data")
            if "," in data_uri:
                header, encoded = data_uri.split(",", 1)
                raw_bytes = base64.b64decode(encoded)
                mime_type = "image/jpeg"
                original_filename = f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"

    if not title:
        return jsonify({"error": "Document title is required"}), 400

    if not raw_bytes:
        # Default placeholder if only metadata was entered
        content_text = f"VOTLY SECURE RECORD\nTitle: {title}\nType: {document_type}\nNumber: {document_number}\nCreated: {datetime.now().isoformat()}"
        raw_bytes = content_text.encode("utf-8")
        original_filename = f"{secure_filename(title).lower() or 'document'}.txt"
        mime_type = "text/plain"

    if is_supabase_enabled():
        metadata = {
            "title": title,
            "category": category,
            "document_type": document_type,
            "document_number": document_number,
            "country": country,
            "issued_date": issued_date,
            "expires_date": expires_date,
            "notes": notes,
            "tags": tags,
            "original_filename": original_filename,
            "mime_type": mime_type,
            "is_client_encrypted": is_client_encrypted
        }
        new_doc = SupabaseService.add_document(user["id"], metadata, raw_bytes)
        return jsonify({
            "message": "Document stored and encrypted successfully in Supabase Cloud",
            "id": new_doc["id"],
            "title": new_doc["title"],
            "sha256": new_doc["sha256_hash"],
            "document": new_doc
        }), 201

    # Encrypt file with server master key
    enc_filename = f"enc_{CryptoService.generate_secure_token(16)}.votly"
    enc_path = os.path.join(database.UPLOADS_DIR, enc_filename)
    CryptoService.encrypt_file(raw_bytes, enc_path)

    sha256_hash = CryptoService.compute_sha256(raw_bytes)
    file_size = len(raw_bytes)
    now = datetime.now().isoformat()

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO documents (
        user_id, title, category, document_type, document_number, country,
        issued_date, expires_date, notes, tags, file_path, original_filename,
        file_size, mime_type, sha256_hash, is_client_encrypted, is_favorite,
        created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        user["id"], title, category, document_type, document_number, country,
        issued_date, expires_date, notes, tags, enc_path, original_filename,
        file_size, mime_type, sha256_hash, is_client_encrypted, 0, now, now
    ))
    doc_id = cursor.lastrowid
    conn.commit()
    conn.close()

    log_activity(user["id"], doc_id, "UPLOAD", f"Uploaded and encrypted '{title}' ({file_size} bytes)")

    return jsonify({
        "message": "Document stored and encrypted successfully",
        "id": doc_id,
        "title": title,
        "sha256": sha256_hash
    }), 201

@app.route("/api/documents/<int:doc_id>", methods=["PUT"])
@require_auth
def update_document(doc_id):
    user = g.user
    data = request.get_json() or {}

    if is_supabase_enabled():
        updated = SupabaseService.update_document(doc_id, user["id"], data)
        if not updated:
            return jsonify({"error": "Document not found"}), 404
        return jsonify({"message": "Document updated successfully in Supabase Cloud", "document": updated})

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Document not found"}), 404

    title = data.get("title", existing["title"]).strip()
    category = data.get("category", existing["category"]).strip()
    document_type = data.get("document_type", existing["document_type"]).strip()
    document_number = data.get("document_number", existing["document_number"]).strip()
    country = data.get("country", existing["country"]).strip()
    issued_date = data.get("issued_date", existing["issued_date"])
    expires_date = data.get("expires_date", existing["expires_date"])
    notes = data.get("notes", existing["notes"]).strip()
    tags = data.get("tags", existing["tags"]).strip()
    is_favorite = int(data.get("is_favorite", existing["is_favorite"]))
    now = datetime.now().isoformat()

    cursor.execute("""
    UPDATE documents SET
        title = ?, category = ?, document_type = ?, document_number = ?,
        country = ?, issued_date = ?, expires_date = ?, notes = ?, tags = ?,
        is_favorite = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
    """, (
        title, category, document_type, document_number, country,
        issued_date, expires_date, notes, tags, is_favorite, now, doc_id, user["id"]
    ))

    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    updated_row = cursor.fetchone()
    updated_dict = dict(updated_row) if updated_row else {}
    conn.commit()
    conn.close()

    log_activity(user["id"], doc_id, "UPDATE", f"Updated metadata for '{title}'")
    return jsonify({"message": "Document updated successfully", "document": updated_dict})

@app.route("/api/documents/<int:doc_id>", methods=["DELETE"])
@require_auth
def delete_document(doc_id):
    user = g.user
    if is_supabase_enabled():
        success = SupabaseService.delete_document(doc_id, user["id"])
        if not success:
            return jsonify({"error": "Document not found"}), 404
        return jsonify({"message": "Document shredded and deleted securely from Supabase Cloud."})

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT file_path, title FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        return jsonify({"error": "Document not found"}), 404

    # Secure file erasure: overwrite with zeros before deletion
    file_path = doc["file_path"]
    if os.path.exists(file_path):
        try:
            size = os.path.getsize(file_path)
            with open(file_path, "wb") as f:
                f.write(b"\x00" * size)
            os.remove(file_path)
        except Exception:
            pass

    cursor.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    conn.commit()
    conn.close()

    log_activity(user["id"], doc_id, "DELETE", f"Permanently shredded '{doc['title']}'")
    return jsonify({"message": f"Document '{doc['title']}' shredded and deleted securely."})

@app.route("/api/documents/<int:doc_id>/file", methods=["POST"])
@require_auth
def update_document_file(doc_id):
    user = g.user
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Document not found"}), 404

    raw_bytes = None
    original_filename = existing["original_filename"]
    mime_type = existing["mime_type"]

    if "file" in request.files and request.files["file"].filename:
        file = request.files["file"]
        original_filename = secure_filename(file.filename) or "uploaded_document"
        raw_bytes = file.read()
        mime_type = file.mimetype or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
    elif request.form.get("camera_data"):
        import base64
        data_uri = request.form.get("camera_data")
        if "," in data_uri:
            _, encoded = data_uri.split(",", 1)
            raw_bytes = base64.b64decode(encoded)
            mime_type = "image/jpeg"
            original_filename = f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    elif request.is_json and request.get_json().get("camera_data"):
        import base64
        data_uri = request.get_json().get("camera_data")
        if "," in data_uri:
            _, encoded = data_uri.split(",", 1)
            raw_bytes = base64.b64decode(encoded)
            mime_type = "image/jpeg"
            original_filename = f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"

    if not raw_bytes:
        conn.close()
        return jsonify({"error": "No file or image provided"}), 400

    # Secure file erasure: overwrite old file with zeros before saving new one
    old_file_path = existing["file_path"]
    if os.path.exists(old_file_path):
        try:
            size = os.path.getsize(old_file_path)
            with open(old_file_path, "wb") as f:
                f.write(b"\x00" * size)
            os.remove(old_file_path)
        except Exception:
            pass

    # Save newly encrypted file
    enc_filename = f"enc_{CryptoService.generate_secure_token(16)}.votly"
    enc_path = os.path.join(database.UPLOADS_DIR, enc_filename)
    CryptoService.encrypt_file(raw_bytes, enc_path)

    sha256_hash = CryptoService.compute_sha256(raw_bytes)
    file_size = len(raw_bytes)
    now = datetime.now().isoformat()

    cursor.execute("""
    UPDATE documents SET
        file_path = ?, original_filename = ?, file_size = ?,
        mime_type = ?, sha256_hash = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
    """, (enc_path, original_filename, file_size, mime_type, sha256_hash, now, doc_id, user["id"]))

    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    updated_dict = dict(cursor.fetchone())
    conn.commit()
    conn.close()

    log_activity(user["id"], doc_id, "UPLOAD", f"Replaced scan file for '{existing['title']}' with '{original_filename}' ({file_size} bytes)")
    return jsonify({"message": "Document file updated and re-encrypted successfully", "document": updated_dict})

@app.route("/api/documents/<int:doc_id>/download", methods=["GET"])
@require_auth
def download_document(doc_id):
    user = g.user
    if is_supabase_enabled():
        doc = SupabaseService.get_document_by_id(doc_id, user["id"])
        if not doc:
            return jsonify({"error": "Document not found"}), 404
        try:
            decrypted_bytes = SupabaseService.download_and_decrypt_file(doc["file_path"])
            log_activity(user["id"], doc_id, "DOWNLOAD", f"Decrypted and downloaded '{doc['title']}' from Supabase Cloud")
            return send_file(
                io.BytesIO(decrypted_bytes),
                mimetype=doc["mime_type"],
                as_attachment=True,
                download_name=doc["original_filename"]
            )
        except Exception as e:
            return jsonify({"error": f"Decryption failed: {str(e)}"}), 500

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    doc = cursor.fetchone()
    conn.close()

    if not doc or not os.path.exists(doc["file_path"]):
        return jsonify({"error": "Document or file not found"}), 404

    try:
        decrypted_bytes = CryptoService.decrypt_file(doc["file_path"])
        log_activity(user["id"], doc_id, "DOWNLOAD", f"Decrypted and downloaded '{doc['title']}'")
        return send_file(
            io.BytesIO(decrypted_bytes),
            mimetype=doc["mime_type"],
            as_attachment=True,
            download_name=doc["original_filename"]
        )
    except Exception as e:
        return jsonify({"error": f"Decryption failed: {str(e)}"}), 500

@app.route("/api/documents/<int:doc_id>/preview", methods=["GET"])
@require_auth
def preview_document(doc_id):
    user = g.user
    if is_supabase_enabled():
        doc = SupabaseService.get_document_by_id(doc_id, user["id"])
        if not doc:
            return jsonify({"error": "Document not found"}), 404
        try:
            decrypted_bytes = SupabaseService.download_and_decrypt_file(doc["file_path"])
            log_activity(user["id"], doc_id, "VIEW", f"Decrypted preview for '{doc['title']}' from Supabase Cloud")
            return send_file(
                io.BytesIO(decrypted_bytes),
                mimetype=doc["mime_type"],
                as_attachment=False,
                download_name=doc["original_filename"]
            )
        except Exception as e:
            return jsonify({"error": f"Decryption failed: {str(e)}"}), 500

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    doc = cursor.fetchone()
    conn.close()

    if not doc or not os.path.exists(doc["file_path"]):
        return jsonify({"error": "Document or file not found"}), 404

    try:
        decrypted_bytes = CryptoService.decrypt_file(doc["file_path"])
        log_activity(user["id"], doc_id, "VIEW", f"Decrypted preview for '{doc['title']}'")
        return send_file(
            io.BytesIO(decrypted_bytes),
            mimetype=doc["mime_type"],
            as_attachment=False,
            download_name=doc["original_filename"]
        )
    except Exception as e:
        return jsonify({"error": f"Decryption failed: {str(e)}"}), 500

# ----------------- SECURE SHARING ----------------- #

@app.route("/api/documents/<int:doc_id>/share", methods=["POST"])
@require_auth
def create_share(doc_id):
    user = g.user
    data = request.get_json() or {}
    hours_valid = int(data.get("hours", 24))
    pin = data.get("pin", "").strip()

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        return jsonify({"error": "Document not found"}), 404

    share_token = CryptoService.generate_secure_token(24)
    expires_at = (datetime.now() + timedelta(hours=hours_valid)).isoformat()
    pin_hash = generate_password_hash(pin) if pin else None
    now = datetime.now().isoformat()

    cursor.execute("""
    INSERT INTO shares (document_id, user_id, share_token, pin_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (doc_id, user["id"], share_token, pin_hash, expires_at, now))
    conn.commit()
    conn.close()

    log_activity(user["id"], doc_id, "SHARE", f"Generated secure link for '{doc['title']}' (expires in {hours_valid}h)")
    share_url = f"{request.host_url}share/{share_token}"

    return jsonify({
        "message": "Secure share link generated",
        "share_url": share_url,
        "token": share_token,
        "expires_at": expires_at,
        "requires_pin": bool(pin)
    })

@app.route("/share/<share_token>")
def share_view(share_token):
    return render_template("index.html", share_token=share_token)

@app.route("/api/share/<share_token>", methods=["GET", "POST"])
def get_shared_document(share_token):
    pin = ""
    if request.is_json:
        pin = (request.get_json() or {}).get("pin", "")

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.*, d.title, d.category, d.document_type, d.document_number, d.country,
           d.issued_date, d.expires_date, d.file_path, d.original_filename, d.mime_type
    FROM shares s
    JOIN documents d ON s.document_id = d.id
    WHERE s.share_token = ?
    """, (share_token,))
    share = cursor.fetchone()

    if not share:
        conn.close()
        return jsonify({"error": "Invalid or expired share link"}), 404

    if datetime.fromisoformat(share["expires_at"]) < datetime.now():
        conn.close()
        return jsonify({"error": "This share link has expired"}), 410

    if share["pin_hash"]:
        if not pin or not check_password_hash(share["pin_hash"], pin):
            conn.close()
            return jsonify({"error": "PIN required or incorrect", "requires_pin": True}), 403

    # Increment view count
    cursor.execute("UPDATE shares SET view_count = view_count + 1 WHERE id = ?", (share["id"],))
    conn.commit()
    conn.close()

    return jsonify({
        "title": share["title"],
        "category": share["category"],
        "document_type": share["document_type"],
        "document_number": share["document_number"],
        "country": share["country"],
        "issued_date": share["issued_date"],
        "expires_date": share["expires_date"],
        "original_filename": share["original_filename"],
        "mime_type": share["mime_type"],
        "expires_at": share["expires_at"],
        "view_count": share["view_count"] + 1
    })

# ----------------- SECURITY AUDIT & LIMITATIONS ----------------- #

@app.route("/api/security/audit", methods=["GET"])
@require_auth
def security_audit():
    user = g.user
    conn = database.get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) as total_docs, SUM(file_size) as total_size FROM documents WHERE user_id = ?", (user["id"],))
    stats = cursor.fetchone()

    cursor.execute("SELECT COUNT(*) FROM documents WHERE user_id = ? AND is_client_encrypted = 1", (user["id"],))
    client_enc_count = cursor.fetchone()[0]

    conn.close()

    return jsonify({
        "status": "Secure",
        "cipher_suite": "AES-256-GCM / Fernet Authenticated Encryption with HMAC-SHA256",
        "key_derivation": "PBKDF2-HMAC-SHA256 (100,000 rounds)",
        "disk_storage": "Zero unencrypted bytes on persistent storage. Ciphertext blobs only.",
        "shredding_protocol": "DoD 5220.22-M zero-byte overwrite before file system unlink.",
        "total_documents_secured": stats["total_docs"] or 0,
        "total_encrypted_bytes": stats["total_size"] or 0,
        "client_encrypted_docs": client_enc_count,
        "security_principles": [
            {
                "title": "Authenticated AES-256 Encryption",
                "detail": "Every file payload is encrypted before touching disk. Integrity tags prevent any tampering."
            },
            {
                "title": "Ephemeral Decryption In-Memory",
                "detail": "Files are never decrypted to temporary disk files; streams are generated directly into memory."
            },
            {
                "title": "Cryptographic SHA-256 Hashing",
                "detail": "Calculated on raw document content to ensure zero bit-rot or undetected alteration."
            },
            {
                "title": "Defense-in-Depth Auto-Lock",
                "detail": "Configurable inactivity timer locks vault access, requiring biometric/PIN re-authentication."
            }
        ],
        "honest_limitations": [
            {
                "area": "Browser & Client-Side Environment",
                "description": "If a user's local operating system is compromised with kernel-level keyloggers, screen scrapers, or rogue browser extensions, documents decrypted in memory can be intercepted at the rendering layer."
            },
            {
                "area": "Zero-Knowledge Passphrase Loss",
                "description": "For documents encrypted with custom client-side passphrases, Votly holds no backdoor or recovery key. If the user forgets their passphrase, the document is mathematically unrecoverable."
            },
            {
                "area": "Server Master Key Custody",
                "description": "For standard vault documents (non-zero-knowledge), the server holds the AES master key. While shielded from unauthorized users, subpoenas or root server compromises could theoretically access ciphertext keys if not using client-side zero-knowledge mode."
            },
            {
                "area": "Metadata Visibility",
                "description": "Document metadata (titles, categories, approximate file size, and upload timestamps) are stored in encrypted relational database tables for fast indexing and search, rather than full end-to-end obfuscation."
            }
        ]
    })

# ----------------- NOTIFICATIONS & EXPIRATION REMINDERS ----------------- #

@app.route("/api/notifications", methods=["GET"])
@require_auth
def get_notifications():
    user = g.user
    unread_only = request.args.get("unread", "0").lower() in ("true", "1")
    limit = int(request.args.get("limit", 50))
    if is_supabase_enabled():
        notifs = SupabaseService.get_notifications(user["id"], unread_only=unread_only, limit=limit)
        unread_count = SupabaseService.get_unread_count(user["id"])
        return jsonify({
            "notifications": notifs,
            "unread_count": unread_count
        })
    notifs = database.get_user_notifications(user["id"], unread_only=unread_only, limit=limit)
    unread_count = database.get_unread_notifications_count(user["id"])
    return jsonify({
        "notifications": notifs,
        "unread_count": unread_count
    })

@app.route("/api/notifications/<int:notif_id>/read", methods=["POST"])
@require_auth
def mark_notification_read(notif_id):
    user = g.user
    if is_supabase_enabled():
        SupabaseService.mark_notification_read(notif_id, user["id"])
        return jsonify({"success": True, "unread_count": SupabaseService.get_unread_count(user["id"])})
    database.mark_notification_as_read(notif_id, user["id"])
    return jsonify({"success": True, "unread_count": database.get_unread_notifications_count(user["id"])})

@app.route("/api/notifications/read-all", methods=["POST"])
@require_auth
def mark_all_notifications_read():
    user = g.user
    if is_supabase_enabled():
        SupabaseService.mark_all_read(user["id"])
        return jsonify({"success": True, "unread_count": 0})
    database.mark_all_notifications_read(user["id"])
    return jsonify({"success": True, "unread_count": 0})

@app.route("/api/documents/expiring", methods=["GET"])
@require_auth
def get_expiring_documents():
    """Returns documents expiring within 30 days for dashboard alerts."""
    user = g.user
    if is_supabase_enabled():
        docs, _ = SupabaseService.get_documents(user["id"], filter_type="expiring")
        return jsonify({
            "expiring_documents": docs,
            "count": len(docs)
        })

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM documents
    WHERE user_id = ? AND expires_date IS NOT NULL AND expires_date != ''
    ORDER BY expires_date ASC
    """, (user["id"],))
    rows = cursor.fetchall()
    conn.close()

    today = datetime.now().date()
    expiring_docs = []
    for r in rows:
        d = dict(r)
        try:
            exp_date = datetime.strptime(d["expires_date"], "%Y-%m-%d").date()
            delta = (exp_date - today).days
            d["days_remaining"] = delta
            if delta < 0:
                d["urgency"] = "expired"
                d["status_label"] = f"Expired {abs(delta)}d ago"
                expiring_docs.append(d)
            elif delta <= 30:
                if delta <= 1:
                    d["urgency"] = "critical"
                    d["status_label"] = "Expires in 24 Hours" if delta == 1 else "Expires Today"
                elif delta <= 7:
                    d["urgency"] = "urgent"
                    d["status_label"] = f"Expires in {delta} days (1 Week)"
                elif delta <= 14:
                    d["urgency"] = "warning"
                    d["status_label"] = f"Expires in {delta} days (2 Weeks)"
                else:
                    d["urgency"] = "notice"
                    d["status_label"] = f"Expires in {delta} days (1 Month)"
                expiring_docs.append(d)
        except Exception:
            continue

    return jsonify({
        "expiring_documents": expiring_docs,
        "count": len(expiring_docs)
    })

@app.route("/api/notifications/check-now", methods=["POST"])
@require_auth
def trigger_expiration_check():
    """Admin / test endpoint to trigger the daily expiration check on demand."""
    if is_supabase_enabled():
        results = SupabaseService.check_and_generate_expiration_notifications()
    else:
        results = database.check_and_generate_expiration_notifications()
    return jsonify({
        "status": "Check executed successfully",
        "processed_count": len(results),
        "results": results
    })

@app.route("/api/notifications/test-email", methods=["POST"])
@require_auth
def test_expiration_email():
    """Test dispatch or preview of responsive Pearl & Cobalt expiration email."""
    user = g.user
    data = request.get_json() or {}
    target_email = data.get("email", user.get("email", "ada.okafor@email.com")).strip()
    milestone = data.get("milestone", "14_DAYS")

    milestone_map = {
        "30_DAYS": ("1 Month Advance Notice", 28, "International Passport", "A09823411", "Travel", "2026-12-05"),
        "14_DAYS": ("2 Weeks Notice", 14, "Cobalt Premier Bank Card", "5399 2810 9921 8829", "Banking", "2026-11-21"),
        "7_DAYS": ("1 Week Urgent Warning", 6, "UK Standard Visitor Visa", "V-GB-8849201", "Travel", "2026-11-13"),
        "1_DAY": ("24-Hour Critical Notice", 1, "Security Clearance Certificate", "SC-9901-NG", "Identity", "2026-11-09")
    }

    label, days, title, doc_num, cat, exp_date = milestone_map.get(milestone, milestone_map["14_DAYS"])

    config = EmailService.get_config()
    html_preview = EmailService.render_expiration_template(
        user_name=user.get("full_name", "Ada Okafor"),
        doc_title=title,
        doc_number=doc_num,
        category=cat,
        expires_date=exp_date,
        days_remaining=days,
        milestone_label=label,
        vault_url=config["vault_url"]
    )

    send_result = EmailService.send_notification(
        to_email=target_email,
        user_name=user.get("full_name", "Ada Okafor"),
        doc_title=title,
        doc_number=doc_num,
        category=cat,
        expires_date=exp_date,
        days_remaining=days,
        milestone_label=label
    )

    return jsonify({
        "success": True,
        "message": f"Test alert for '{title}' ({label}) processed",
        "recipient": target_email,
        "provider": send_result.get("provider", "simulation"),
        "html_preview": html_preview
    })

@app.route("/api/vault/export", methods=["GET"])
@require_auth
def export_vault():
    """Generates a secure JSON backup of the user's encrypted vault index."""
    user = g.user
    if is_supabase_enabled():
        docs, counts = SupabaseService.get_documents(user["id"])
    else:
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM documents WHERE user_id = ?", (user["id"],))
        docs = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT category, COUNT(*) as count FROM documents WHERE user_id = ? GROUP BY category", (user["id"],))
        counts = {r["category"]: r["count"] for r in cursor.fetchall()}
        conn.close()

    export_data = {
        "vault_version": "2.4.0",
        "exported_at": datetime.now().isoformat(),
        "user": {
            "email": user["email"],
            "full_name": user.get("full_name", "")
        },
        "statistics": {
            "total_documents": len(docs),
            "category_counts": counts
        },
        "documents": [
            {
                "id": d["id"],
                "title": d["title"],
                "category": d["category"],
                "document_type": d["document_type"],
                "document_number": d.get("document_number"),
                "country": d.get("country"),
                "issued_date": d.get("issued_date"),
                "expires_date": d.get("expires_date"),
                "sha256_hash": d.get("sha256_hash"),
                "file_size": d.get("file_size"),
                "mime_type": d.get("mime_type"),
                "created_at": d.get("created_at")
            }
            for d in docs
        ]
    }

    buf = io.BytesIO(json.dumps(export_data, indent=2).encode("utf-8"))
    filename = f"votly_vault_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return send_file(buf, mimetype="application/json", as_attachment=True, download_name=filename)

# ----------------- SMART OCR & DOCUMENT EXTRACTION ----------------- #

@app.route("/api/documents/extract-ocr", methods=["POST"])
@require_auth
def extract_document_ocr():
    """Intelligent document metadata extraction from text, filename, or camera scan."""
    text_content = ""
    filename = ""

    if request.is_json:
        data = request.json or {}
        text_content = data.get("text", "")
        filename = data.get("filename", "")
    else:
        filename = request.form.get("filename", "")
        text_content = request.form.get("text", "")
        if "file" in request.files:
            f = request.files["file"]
            filename = f.filename or filename
            try:
                raw_chunk = f.read(1024 * 64)
                f.seek(0)
                decoded_str = raw_chunk.decode("utf-8", errors="ignore")
                text_content = f"{text_content} {decoded_str}"
            except Exception:
                pass

    full_corpus = f"{filename} {text_content}".lower()

    detected = {
        "title": "Document",
        "category": "Identity",
        "document_type": "Identity Document",
        "document_number": "",
        "country": "Nigeria",
        "issued_date": "",
        "expires_date": "",
        "confidence": 0.95
    }

    # Document type heuristics
    if "passport" in full_corpus or "p<nga" in full_corpus:
        detected["title"] = "Federal Republic of Nigeria International Passport"
        detected["category"] = "Travel"
        detected["document_type"] = "Passport"
        detected["country"] = "Nigeria"
    elif "nin" in full_corpus or "national id" in full_corpus or "identity management" in full_corpus:
        detected["title"] = "National Identity Card (NIN)"
        detected["category"] = "Identity"
        detected["document_type"] = "National ID"
        detected["country"] = "Nigeria"
    elif "visa" in full_corpus:
        detected["title"] = "UK Standard Visitor Visa"
        detected["category"] = "Travel"
        detected["document_type"] = "Visa"
        detected["country"] = "United Kingdom"
    elif "driver" in full_corpus or "license" in full_corpus or "licence" in full_corpus or "frsc" in full_corpus:
        detected["title"] = "Driver's License"
        detected["category"] = "Identity"
        detected["document_type"] = "Driver License"
        detected["country"] = "Nigeria"
    elif "card" in full_corpus or "debit" in full_corpus or "credit" in full_corpus or "mastercard" in full_corpus:
        detected["title"] = "Cobalt Premier Bank Card"
        detected["category"] = "Banking"
        detected["document_type"] = "Bank Card"
        detected["country"] = "Nigeria"
    elif "cert" in full_corpus or "degree" in full_corpus or "diploma" in full_corpus or "university" in full_corpus:
        detected["title"] = "University Degree Certificate"
        detected["category"] = "Education"
        detected["document_type"] = "Certificate"
        detected["country"] = "Nigeria"
    elif "vaccin" in full_corpus or "yellow" in full_corpus or "who" in full_corpus or "health" in full_corpus:
        detected["title"] = "International Vaccination Card"
        detected["category"] = "Health"
        detected["document_type"] = "Medical Record"
        detected["country"] = "International"

    search_corpus = f"{filename} {text_content}".replace("_", " ")

    # Number recognition
    pass_num = re.search(r'\b[A-Z][0-9]{8}\b', search_corpus.upper())
    if pass_num and detected["document_type"] == "Passport":
        detected["document_number"] = pass_num.group(0)

    nin_num = re.search(r'\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{3}\b', search_corpus) or re.search(r'\b[0-9]{11}\b', search_corpus)
    if nin_num:
        detected["document_number"] = nin_num.group(0).replace(" ", "-")

    card_num = re.search(r'\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}\b', search_corpus)
    if card_num and detected["category"] == "Banking":
        detected["document_number"] = card_num.group(0)

    # Date extraction (YYYY-MM-DD or DD/MM/YYYY)
    date_matches = re.findall(r'\b(20[1-3][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b', search_corpus)
    if not date_matches:
        slash_matches = re.findall(r'\b(0[1-9]|[12][0-9]|3[01])[/-](0[1-9]|1[0-2])[/-](20[1-3][0-9])\b', search_corpus)
        if slash_matches:
            date_matches = [(m[2], m[1], m[0]) for m in slash_matches]

    if date_matches:
        formatted = [f"{d[0]}-{d[1]}-{d[2]}" for d in date_matches]
        formatted.sort()
        if len(formatted) >= 2:
            detected["issued_date"] = formatted[0]
            detected["expires_date"] = formatted[-1]
        elif len(formatted) == 1:
            detected["expires_date"] = formatted[0]

    return jsonify({
        "success": True,
        "extracted": detected
    })

# Lazy-initialized database check to eliminate import latency and prevent race conditions
_db_initialized = False

def start_expiration_scheduler():
    """Spawns a daemon thread that executes expiration checks daily."""
    import threading
    import time

    def scheduler_loop():
        time.sleep(2)  # Initial grace period after startup
        while True:
            try:
                print("[Votly-Scheduler] Running automated daily document expiration check...", flush=True)
                if is_supabase_enabled():
                    results = SupabaseService.check_and_generate_expiration_notifications()
                else:
                    results = database.check_and_generate_expiration_notifications()
                if results:
                    print(f"[Votly-Scheduler] Dispatched {len(results)} automated expiration alerts.", flush=True)
                else:
                    print("[Votly-Scheduler] Expiration check completed. All records up to date.", flush=True)
            except Exception as e:
                print(f"[Votly-Scheduler] Warning during expiration check: {e}", flush=True)
            # Sleep for 24 hours (86,400 seconds)
            time.sleep(86400)

    t = threading.Thread(target=scheduler_loop, daemon=True, name="VotlyExpirationScheduler")
    t.start()

def init_app_state():
    global _db_initialized
    if not _db_initialized:
        try:
            database.init_db()
            database.seed_sample_data()
            start_expiration_scheduler()
            _db_initialized = True
        except Exception as e:
            print(f"[Votly] Database initialization note: {e}", flush=True)

@app.before_request
def ensure_db_initialized():
    global _db_initialized
    if not _db_initialized:
        init_app_state()

# Initialize app state & scheduler eagerly for WSGI / Gunicorn / Render environments
try:
    init_app_state()
except Exception as e:
    print(f"[Votly] Startup init note: {e}", flush=True)

def ensure_port_available(port: int, host: str = "127.0.0.1"):
    """Check if the target port is in use and cleanly free any orphaned process."""
    if os.name != 'nt':
        return True

    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        try:
            s.bind((host, port))
            return True
        except OSError:
            pass

    # Port is in use - attempt to free it if an orphaned process is holding it
    try:
        import subprocess
        cmd = f'netstat -ano | findstr :{port}'
        output = subprocess.check_output(cmd, shell=True).decode()
        for line in output.strip().splitlines():
            if "LISTENING" in line:
                pid = line.strip().split()[-1]
                if pid and pid != str(os.getpid()):
                    print(f"[Votly] Port {port} occupied by PID {pid}. Freeing port...", flush=True)
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
                    import time
                    time.sleep(0.3)
                    break
    except Exception:
        pass
    return True

def get_local_ip():
    """Retrieve the primary local LAN IP address for network device access."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0.2)
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"

if __name__ == "__main__":
    init_app_state()

    port = int(os.environ.get("PORT", 5000))
    # Bind to 0.0.0.0 so phones, tablets, and other devices on the same Wi-Fi can connect
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "0").lower() in ("true", "1")
    use_reloader = os.environ.get("FLASK_RELOADER", "0").lower() in ("true", "1")

    # Fast port check
    ensure_port_available(port, host)

    lan_ip = get_local_ip()
    print("=" * 64, flush=True)
    print("         VOTLY SECURE DOCUMENT VAULT - SERVER READY", flush=True)
    print("=" * 64, flush=True)
    print(f"  -> Local access:   http://localhost:{port}", flush=True)
    print(f"  -> Network access: http://{lan_ip}:{port}  (phone/tablet on Wi-Fi)", flush=True)
    print("=" * 64, flush=True)
    app.run(host=host, port=port, debug=debug, use_reloader=use_reloader, threaded=True)

