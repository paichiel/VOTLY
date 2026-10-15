# Votly — Secure Digital Document Vault

> *"Your identity. Your documents. One secure vault."*

**Votly** is a high-security digital document vault featuring a **Pearl White and Cobalt** design system inspired by Apple-grade simplicity, fluid micro-animations, distinctive cryptographic document cards, and real backend security.

---

## 💎 Design System & Palette

- **Pearl White Light Base (`#F8FAFC` to `#FFFFFF`)**:
  - Soft ambient pearl shimmer (`radial-gradient`), frosted glass panels with `backdrop-filter: blur(18px)`.
  - Crisp 1px borders (`rgba(226, 232, 240, 0.85)`).
- **Vibrant Cobalt (`#2563EB`, `#1D4ED8`, `#1E3A8A`)**:
  - Radiant cobalt primary buttons, glowing badges, and security status gradient banners.
- **Cobalt Obsidian Dark Mode**:
  - Deep `#0A0F1D` obsidian canvas with luminous cobalt accents and pearl typography.
- **Dual Display Modes**:
  - **Desktop View**: Spacious, responsive multi-column layout for widescreen monitors and tablets.
  - **iPhone 16 Pro View**: Seamless interactive device simulator with dynamic island and bottom tab navigation matching the 8 screens from the design mockups.

---

## 📱 Faithful Screen-by-Screen Implementation

| Screen | Title | Description & Features |
|---|---|---|
| **Screen 1** | **Onboarding / Landing** | Stylized V-shield brand mark, floating 3D vault hero illustration, value proposition, and 1-click Quick Demo sign-in. |
| **Screen 2** | **Home Dashboard** | Personalized greeting ("Good morning, Ada"), glowing **"Your Vault is Secure"** banner, Quick Access shortcuts (Scan, Upload, Search, Share), and categorized document counts. |
| **Screen 3** | **Documents List** | Instant category folder browsing, search bar, sort toggle (Newest, Expiry, Name), and cryptographic status tags. |
| **Screen 4** | **Document Detail & Card Showcase** | Realistic distinctive card rendering: **Federal Republic of Nigeria International Passport** (gold coat of arms, debossed texture, e-passport chip), **NIN Identity Card**, **Cobalt Premier Card**, and **Degree Certificate**. Metadata breakdown, in-browser preview, and decrypted download. |
| **Screen 5** | **Camera Document Scanner** | Live HTML5 webcam feed (`getUserMedia`), animated laser scan beam, corner guide reticle ("Position the document within the frame"), shutter capture, and fallback upload. |
| **Screen 6** | **Search View** | Real-time search across titles, document numbers, countries, and notes with category filter pills (`All`, `Identity`, `Travel`, `Personal`, `Banking`, `Health`). |
| **Screen 7** | **Add Document** | Modal flow supporting direct camera scan, drag & drop file upload (PDF, PNG, JPG), metadata fields, and AES-256 vault encryption. |
| **Screen 8** | **Settings & Security** | User profile management, PIN change, Auto-Lock configuration, theme toggle, and the **Security Architecture & Honest Limitations** report. |

---

## 🔒 Cryptographic Security Architecture

1. **Authenticated AES-256 Encryption**:
   - Every file uploaded to the vault is encrypted before touching disk storage (`static/uploads/`).
   - Ciphertext files are stored with random IVs and HMAC-SHA256 authenticated integrity tags.
2. **In-Memory Ephemeral Decryption**:
   - Decrypted data is never written to temporary files on disk. Decryption occurs purely in-memory on demand when previewing or downloading.
3. **SHA-256 Cryptographic Fingerprints**:
   - Calculated across raw file bytes upon ingestion to detect bit-rot or unauthorized modification.
4. **Client-Side Zero-Knowledge Encryption**:
   - Includes WebCrypto API engine (`static/js/crypto.js`) for PBKDF2 (100,000 rounds) 256-bit AES-GCM key derivation from a user-supplied private passphrase.
5. **Secure Document Shredding**:
   - Deleting a document performs a DoD 5220.22-M zero-byte overwrite on the ciphertext disk file before unlinking.
6. **Defense-in-Depth Auto-Lock**:
   - Inactivity tracker automatically locks the vault after 5 minutes of idle time, prompting for a 4-digit security PIN (Default: `1234`).

---

## ⚠️ Transparent Security Limitations Disclosure

In adherence to high security standards, Votly transparently documents its architectural boundaries:

1. **Client Browser & DOM Exposure**:
   - While files are encrypted at rest and in transit, decrypted documents temporarily exist in client memory and the DOM during active display. If a user's machine is compromised with kernel keyloggers, screen scrapers, or malicious browser extensions, rendered content can be intercepted.
2. **Zero-Knowledge Passphrase Irrecoverability**:
   - For client-side encrypted files, Votly maintains no master recovery keys or backdoors. If the user forgets their custom passphrase, the data is mathematically lost forever.
3. **Server-Assisted Master Key Custody**:
   - For standard vault documents, the server maintains the AES master key. While secured against standard users, root server compromises could access the key unless the client-side Zero-Knowledge passphrase option is selected.
4. **Metadata Visibility**:
   - Document metadata (titles, categories, upload dates) is stored in protected relational database columns for instant indexed search, rather than full end-to-end ciphertext obfuscation.

---

## 🚀 Running the Web Application

### Prerequisites
- Python 3.10+ (Tested on Python 3.14)
- Dependencies installed: `flask`, `cryptography`, `pillow`

### Start the Server
Double-click `run_votly.bat` or run:
```bash
python app.py
```

Open your browser to:
```
http://127.0.0.1:5000
```

### Demo Credentials
- **Account**: Ada Okafor (`ada.okafor@email.com`)
- **Password**: `Password123!`
- **Security PIN**: `1234`
- *(Or tap "Sign In as Ada Okafor (Demo Vault)" on the landing screen for instant access)*
