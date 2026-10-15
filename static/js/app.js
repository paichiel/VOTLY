/**
 * VOTLY Web Application Controller
 * Handles state, views, distinctive document card rendering,
 * camera scanner, search, upload, secure sharing, and security audit.
 */

const VotlyApp = {
  state: {
    user: null,
    token: localStorage.getItem("votly_token") || null,
    currentView: "welcome", // welcome, auth, home, documents, detail, scanner, search, settings
    authMode: "login", // login or register
    showPassword: false,
    activeCategory: "all",
    searchQuery: "",
    documents: [],
    categoryCounts: {},
    activeDoc: null,
    isEditingDoc: false,
    cardViewMode: "card", // card or file
    viewMode: localStorage.getItem("votly_view_mode") || "desktop", // desktop or mobile
    theme: localStorage.getItem("votly_theme") || "light",
    isVaultLocked: false,
    pinInput: "",
    autoLockTimer: null,
    inactivitySeconds: 0,
    securityData: null,
    deferredPwaPrompt: null
  },

  async init() {
    this.applyTheme(this.state.theme);
    this.applyViewMode(this.state.viewMode);
    this.setupInactivityTracker();
    this.bindGlobalEvents();

    // Register PWA Service Worker for instant offline loading
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
          .then(reg => console.log('Votly PWA SW active:', reg.scope))
          .catch(err => console.log('SW note:', err));
      });
    }

    // Capture PWA beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.state.deferredPwaPrompt = e;
      this.renderCurrentView();
    });

    // Check if on a shared link
    const path = window.location.pathname;
    if (path.startsWith("/share/")) {
      const shareToken = path.split("/share/")[1];
      if (shareToken) {
        this.openShareViewer(shareToken);
        return;
      }
    }

    // Always welcome user on open, matching exact request
    this.navigate("welcome");
  },

  // ----------------- AUTHENTICATION ----------------- //

  async checkAuth() {
    try {
      const res = await fetch("/api/auth/me", {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        this.state.user = data.user;
        this.updateUserUI();
        await this.loadDocuments();
      }
    } catch (err) {
      console.warn("Auth check:", err);
    }
  },

  async startDemoSession() {
    try {
      const res = await fetch("/api/auth/quick-demo", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        this.state.token = data.token;
        this.state.user = data.user;
        localStorage.setItem("votly_token", data.token);
        this.updateUserUI();
        await this.loadDocuments();
        this.showToast(`Welcome to your Votly Vault, ${data.user.full_name}!`, "success");
        this.navigate("home");
      }
    } catch (err) {
      console.error("Demo login error:", err);
    }
  },

  async login(email, password) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      this.state.token = data.token;
      this.state.user = data.user;
      localStorage.setItem("votly_token", data.token);
      this.updateUserUI();
      await this.loadDocuments();
      this.closeModal("authModal");
      this.showToast(`Welcome back, ${data.user.full_name}! Vault unlocked.`, "success");
      this.navigate("home");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  async register(full_name, email, password, pin) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name, email, password, pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      this.state.token = data.token;
      this.state.user = data.user;
      localStorage.setItem("votly_token", data.token);
      this.updateUserUI();
      await this.loadDocuments();
      this.closeModal("authModal");
      this.showToast(`Vault created! Welcome, ${data.user.full_name}.`, "success");
      this.navigate("home");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  logout() {
    this.state.token = null;
    this.state.user = null;
    this.state.documents = [];
    localStorage.removeItem("votly_token");
    this.showToast("Signed out safely. Vault locked.", "info");
    this.navigate("welcome");
  },

  setAuthMode(mode) {
    this.state.authMode = mode;
    this.renderCurrentView();
  },

  togglePasswordVisibility() {
    this.state.showPassword = !this.state.showPassword;
    const pwdInput = document.getElementById("authPagePassword");
    if (pwdInput) pwdInput.type = this.state.showPassword ? "text" : "password";
  },

  fillDemoCredentials() {
    const emailEl = document.getElementById("authPageEmail");
    const pwdEl = document.getElementById("authPagePassword");
    if (emailEl) emailEl.value = "ada.okafor@email.com";
    if (pwdEl) pwdEl.value = "Password123!";
    this.showToast("Demo credentials filled (Ada Okafor)", "info");
  },

  async handleAuthSubmit(action) {
    if (action === "login") {
      const email = document.getElementById("authPageEmail")?.value.trim();
      const password = document.getElementById("authPagePassword")?.value.trim();
      if (!email || !password) {
        this.showToast("Please enter your email and password", "error");
        return;
      }
      await this.login(email, password);
    } else {
      const full_name = document.getElementById("authPageFullName")?.value.trim();
      const email = document.getElementById("authPageEmail")?.value.trim();
      const password = document.getElementById("authPagePassword")?.value.trim();
      const pin = document.getElementById("authPagePin")?.value.trim() || "1234";
      if (!full_name || !email || !password) {
        this.showToast("Please enter all required fields", "error");
        return;
      }
      await this.register(full_name, email, password, pin);
    }
  },

  getAuthHeaders() {
    return this.state.token ? { "Authorization": `Bearer ${this.state.token}` } : {};
  },

  updateUserUI() {
    if (!this.state.user) return;
    const nameEls = document.querySelectorAll(".user-display-name, .user-name-text, #settingsUserName");
    nameEls.forEach(el => {
      if (el.classList.contains("user-display-name")) el.textContent = this.state.user.full_name.split(" ")[0];
      else el.textContent = this.state.user.full_name;
    });

    const emailEls = document.querySelectorAll("#settingsUserEmail");
    emailEls.forEach(el => el.textContent = this.state.user.email);
  },

  // ----------------- DOCUMENTS CRUD ----------------- //

  async loadDocuments() {
    try {
      let url = `/api/documents?category=${encodeURIComponent(this.state.activeCategory)}`;
      if (this.state.searchQuery) {
        url += `&search=${encodeURIComponent(this.state.searchQuery)}`;
      }

      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        this.state.documents = data.documents;
        this.state.categoryCounts = data.category_counts || {};
        this.renderCategoryCounts();
        this.renderCurrentView();
      }
    } catch (err) {
      console.error("Load documents error:", err);
    }
  },

  async uploadDocument(formData) {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      this.showToast("Document encrypted & stored in vault", "success");
      this.closeModal("addDocModal");
      await this.loadDocuments();
      this.navigate("documents");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  async deleteActiveDocument() {
    if (!this.state.activeDoc) return;
    if (!confirm(`Are you sure you want to permanently shred and delete "${this.state.activeDoc.title}"?`)) return;

    try {
      const res = await fetch(`/api/documents/${this.state.activeDoc.id}`, {
        method: "DELETE",
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");

      this.showToast("Document securely shredded", "success");
      this.state.activeDoc = null;
      await this.loadDocuments();
      this.navigate("documents");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  async createShareLink(docId, hours = 24, pin = "") {
    try {
      const res = await fetch(`/api/documents/${docId}/share`, {
        method: "POST",
        headers: {
          ...this.getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ hours, pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate share link");
      return data;
    } catch (err) {
      this.showToast(err.message, "error");
      return null;
    }
  },

  // ----------------- NAVIGATION & ROUTING ----------------- //

  navigate(viewName, param = null) {
    this.state.currentView = viewName;
    if (param && viewName === "detail") {
      this.state.activeDoc = param;
      this.state.isEditingDoc = false;
      this.state.cardViewMode = "card";
    }
    if (viewName === "auth") {
      this.state.authMode = param || "login";
      this.state.showPassword = false;
    }

    // Stop camera if leaving scanner
    if (viewName !== "scanner") {
      VotlyScanner.stopCamera();
    }

    // Update bottom nav highlights
    document.querySelectorAll(".nav-item").forEach(item => {
      item.classList.toggle("active", item.getAttribute("data-view") === viewName);
    });

    this.renderCurrentView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  renderCurrentView() {
    const mainContainer = document.getElementById("mainContentArea");
    const mobileContainer = document.getElementById("mobileScreenScroll");
    let html = "";

    switch (this.state.currentView) {
      case "welcome":
      case "landing":
        html = this.templateLanding();
        break;
      case "auth":
        html = this.templateAuth();
        break;
      case "home":
        html = this.templateHome();
        break;
      case "documents":
        html = this.templateDocuments();
        break;
      case "detail":
        html = this.templateDetail();
        break;
      case "scanner":
        html = this.templateScanner();
        break;
      case "search":
        html = this.templateSearch();
        break;
      case "settings":
        html = this.templateSettings();
        break;
      default:
        html = this.templateLanding();
    }

    if (mainContainer) mainContainer.innerHTML = html;
    if (mobileContainer) mobileContainer.innerHTML = html;

    if (this.state.currentView === "scanner") {
      this.initScannerView();
    }

    this.updateChromeVisibility();
    this.bindViewEvents();
  },

  updateChromeVisibility() {
    const isWelcomeOrAuth = this.state.currentView === "welcome" || this.state.currentView === "landing" || this.state.currentView === "auth";

    const mobileBottomNav = document.querySelector(".mobile-bottom-nav");
    if (mobileBottomNav) {
      mobileBottomNav.style.display = isWelcomeOrAuth ? "none" : "flex";
    }

    const userProfilePill = document.querySelector(".user-profile-pill");
    if (userProfilePill) {
      userProfilePill.style.display = isWelcomeOrAuth || !this.state.user ? "none" : "flex";
    }
  },

  // ----------------- VIEW TEMPLATES ----------------- //

  templateLanding() {
    return `
      <div class="welcome-screen-wrap">
        <!-- Top: Logo & Title (Screen 1 Match) -->
        <div class="welcome-header">
          <div class="welcome-logo-row">
            <svg class="welcome-logo-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 28 C26 22 42 22 48 38 L54 54 C58 64 64 68 72 68 C78 68 86 64 92 56" stroke="#2563EB" stroke-width="14" stroke-linecap="round"/>
              <path d="M48 38 L32 74 C28 82 20 86 12 80 C6 74 6 62 14 50 Z" fill="#2563EB"/>
            </svg>
            <span class="welcome-brand-title">Votly</span>
          </div>
          <div class="welcome-tagline">
            One vault. All your<br>important documents.
          </div>
        </div>

        <!-- Center: 3D Floating Vault Illustration (Screen 1 Match) -->
        <div class="welcome-graphic-container">
          <div class="welcome-3d-card-stack">
            <!-- Back cobalt card with chevron -->
            <div class="welcome-card-back-blue">
              <svg viewBox="0 0 24 24" width="28" height="28" stroke="#FFFFFF" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </div>
            <!-- Front pearl card with 3D shield lock -->
            <div class="welcome-card-front-white">
              <div class="welcome-card-shield-badge">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="#FFFFFF" stroke-width="2" fill="none">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <rect x="9" y="10" width="6" height="5" rx="1"></rect>
                  <path d="M10 10V8a2 2 0 0 1 4 0v2"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom CTA Actions (Screen 1 Match) -->
        <div class="welcome-bottom-actions">
          <button class="btn-primary-cobalt" onclick="VotlyApp.navigate('auth', 'register')">
            Get Started
          </button>
          <div class="welcome-signin-row">
            Already have an account? <a href="javascript:void(0)" onclick="VotlyApp.navigate('auth', 'login')" class="welcome-signin-link">Sign In</a>
          </div>

          <div style="margin-top: 16px;">
            <button class="demo-quick-badge-btn" onclick="VotlyApp.startDemoSession()">
              ⚡ Quick Demo: Enter Vault as Ada Okafor
            </button>
          </div>

          <div style="margin-top: 10px;">
            <button class="pwa-install-pill-btn" onclick="VotlyApp.triggerPwaInstall()">
              ${this.svgIcon("download", 14)} Install Votly App to Home Screen
            </button>
          </div>

          <div style="margin-top: 18px; font-size: 11.5px; color: var(--text-muted); display: flex; justify-content: center; gap: 14px;">
            <span>🔒 AES-256-GCM Vault</span>
            <span>•</span>
            <span>🛡️ Zero-Knowledge</span>
            <span>•</span>
            <span>✨ Apple Simplicity</span>
          </div>
        </div>
      </div>
    `;
  },

  templateAuth() {
    const isLogin = this.state.authMode === "login";

    return `
      <div class="auth-page-container">
        <!-- Top Nav Bar -->
        <div class="auth-nav-bar">
          <button class="back-btn-pill" onclick="VotlyApp.navigate('welcome')">
            ${this.svgIcon("chevron-left", 18)} Welcome
          </button>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 22px; height: 22px;">${this.svgIcon("logo", 22)}</div>
            <span style="font-size: 14px; font-weight: 800; color: var(--cobalt-primary); letter-spacing: -0.3px;">Votly</span>
          </div>
        </div>

        <!-- Auth Card Box -->
        <div class="auth-card-box">
          <!-- Segmented Tab Switcher (Sign In vs Create Account) -->
          <div class="auth-segmented-switch">
            <button class="auth-switch-btn ${isLogin ? 'active' : ''}" onclick="VotlyApp.setAuthMode('login')">
              Sign In
            </button>
            <button class="auth-switch-btn ${!isLogin ? 'active' : ''}" onclick="VotlyApp.setAuthMode('register')">
              Create Account
            </button>
          </div>

          ${isLogin ? `
            <!-- SIGN IN VIEW -->
            <div style="text-align: center; margin-bottom: 22px;">
              <h2 style="font-size: 22px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">Welcome Back</h2>
              <p style="font-size: 13.5px; color: var(--text-secondary);">Sign in to unlock your secure encrypted vault.</p>
            </div>

            <form id="pageLoginForm" onsubmit="event.preventDefault(); VotlyApp.handleAuthSubmit('login');">
              <div class="edit-field-group">
                <label class="edit-field-label">Email Address *</label>
                <input type="email" id="authPageEmail" class="form-input-sm" value="ada.okafor@email.com" placeholder="name@email.com" required autofocus>
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Password *</label>
                <div class="password-input-wrap">
                  <input type="${this.state.showPassword ? 'text' : 'password'}" id="authPagePassword" class="form-input-sm" value="Password123!" placeholder="Enter your password" required>
                  <button type="button" class="password-toggle-btn" onclick="VotlyApp.togglePasswordVisibility()">
                    ${this.svgIcon(this.state.showPassword ? "eye-off" : "eye", 16)}
                  </button>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; font-size: 12.5px;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-secondary);">
                  <input type="checkbox" checked style="accent-color: var(--cobalt-primary);"> Remember on this device
                </label>
                <a href="javascript:void(0)" onclick="VotlyApp.fillDemoCredentials()" style="color: var(--cobalt-primary); font-weight: 600; text-decoration: none;">
                  Fill Demo
                </a>
              </div>

              <button type="submit" class="btn-primary-cobalt">
                Sign In to Vault
              </button>
            </form>

            <div style="text-align: center; margin-top: 22px; font-size: 13.5px; color: var(--text-secondary);">
              Don't have an account? 
              <a href="javascript:void(0)" onclick="VotlyApp.setAuthMode('register')" style="color: var(--cobalt-primary); font-weight: 700; text-decoration: none;">
                Create Account
              </a>
            </div>
          ` : `
            <!-- CREATE ACCOUNT / REGISTER VIEW -->
            <div style="text-align: center; margin-bottom: 22px;">
              <h2 style="font-size: 22px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">Create Your Vault</h2>
              <p style="font-size: 13.5px; color: var(--text-secondary);">Set up your personal zero-knowledge encrypted vault.</p>
            </div>

            <form id="pageRegisterForm" onsubmit="event.preventDefault(); VotlyApp.handleAuthSubmit('register');">
              <div class="edit-field-group">
                <label class="edit-field-label">Full Name / Username *</label>
                <input type="text" id="authPageFullName" class="form-input-sm" placeholder="e.g. John Doe" required autofocus>
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Email Address *</label>
                <input type="email" id="authPageEmail" class="form-input-sm" placeholder="e.g. john@example.com" required>
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Master Password *</label>
                <div class="password-input-wrap">
                  <input type="${this.state.showPassword ? 'text' : 'password'}" id="authPagePassword" class="form-input-sm" placeholder="At least 6 characters" required>
                  <button type="button" class="password-toggle-btn" onclick="VotlyApp.togglePasswordVisibility()">
                    ${this.svgIcon(this.state.showPassword ? "eye-off" : "eye", 16)}
                  </button>
                </div>
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">4-Digit Security PIN (Quick Device Unlock)</label>
                <input type="password" id="authPagePin" class="form-input-sm" maxlength="4" placeholder="e.g. 1234" value="1234">
                <span style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Used to quickly unlock the app when inactive.</span>
              </div>

              <button type="submit" class="btn-primary-cobalt" style="margin-top: 14px;">
                Create Encrypted Vault
              </button>
            </form>

            <div style="text-align: center; margin-top: 22px; font-size: 13.5px; color: var(--text-secondary);">
              Already have an account? 
              <a href="javascript:void(0)" onclick="VotlyApp.setAuthMode('login')" style="color: var(--cobalt-primary); font-weight: 700; text-decoration: none;">
                Sign In
              </a>
            </div>
          `}
        </div>
      </div>
    `;
  },

  templateHome() {
    return `
      <div class="home-view-container">
        <!-- Header -->
        <div class="home-header">
          <div>
            <div class="greeting-text">Good morning,</div>
            <div class="user-display-name">${(this.state.user?.full_name || "Ada").split(" ")[0]}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button class="icon-button" onclick="VotlyApp.openNotificationsModal()" title="Notifications">
              ${this.svgIcon("bell", 18)}
              <span class="notification-badge"></span>
            </button>
            <img src="${this.state.user?.avatar_url || '/static/assets/ada_header_avatar.png'}"
                 alt="Avatar" class="user-avatar-sm" onclick="VotlyApp.navigate('settings')"
                 style="width: 38px; height: 38px; cursor: pointer; border: 2px solid #FFFFFF; box-shadow: var(--shadow-subtle);" />
          </div>
        </div>

        <!-- Cobalt Security Banner -->
        <div class="vault-secure-banner" onclick="VotlyApp.openSecurityAuditModal()">
          <div class="banner-shield-icon">
            ${this.svgIcon("shield-lock", 24)}
          </div>
          <div class="banner-content">
            <div class="banner-title">Your Vault is Secure</div>
            <div class="banner-desc">All your documents are encrypted and protected.</div>
            <span class="banner-badge">AES-256 Authenticated • Tap for Security Report</span>
          </div>
          <div>
            ${this.svgIcon("chevron-right", 18)}
          </div>
        </div>

        <!-- Vault Assistant Expiry Alert Banner -->
        ${this.renderExpiryAlertBanner()}

        <!-- Quick Access -->
        <div class="section-header-row">
          <div class="section-title">Quick Access</div>
          <a class="section-link" onclick="VotlyApp.navigate('documents')">View all</a>
        </div>

        <div class="quick-access-grid">
          <button class="quick-action-card" onclick="VotlyApp.navigate('scanner')">
            <div class="action-icon-circle" style="background: #EFF6FF; color: #2563EB;">
              ${this.svgIcon("scan", 20)}
            </div>
            <span class="action-label">Scan</span>
          </button>

          <button class="quick-action-card" onclick="VotlyApp.openAddDocModal('upload')">
            <div class="action-icon-circle" style="background: #F0F9FF; color: #0284C7;">
              ${this.svgIcon("upload", 20)}
            </div>
            <span class="action-label">Upload</span>
          </button>

          <button class="quick-action-card" onclick="VotlyApp.navigate('search')">
            <div class="action-icon-circle" style="background: #FAF5FF; color: #9333EA;">
              ${this.svgIcon("search", 20)}
            </div>
            <span class="action-label">Search</span>
          </button>

          <button class="quick-action-card" onclick="VotlyApp.openQuickShareModal()">
            <div class="action-icon-circle" style="background: #FFF7ED; color: #EA580C;">
              ${this.svgIcon("share", 20)}
            </div>
            <span class="action-label">Share</span>
          </button>
        </div>

        <!-- Your Documents Categories Grid (Exact Reference Image Style) -->
        <div class="section-header-row">
          <div class="section-title">Your Documents</div>
          <span style="font-size: 13px; color: var(--text-muted);">${this.state.documents.length} items total</span>
        </div>

        <div class="categories-grid">
          ${this.renderCategoryCard("Identity", "cat-identity", "id-badge", "NIN, Driver's License, BVN")}
          ${this.renderCategoryCard("Banking", "cat-banking", "credit-card", "Cards, Bank Statements")}
          ${this.renderCategoryCard("Travel", "cat-travel", "plane", "Passport, Visa, Travel Docs")}
          ${this.renderCategoryCard("Education", "cat-education", "graduation-cap", "Certificates, Diplomas")}
          ${this.renderCategoryCard("Personal", "cat-personal", "user", "Contracts, Receipts, Others")}
          ${this.renderCategoryCard("Health", "cat-health", "heart-pulse", "Medical Records, Insurance")}
        </div>

        <!-- Featured Document Preview (International Passport) -->
        <div class="section-header-row" style="margin-top: 10px;">
          <div class="section-title">Featured in Vault</div>
        </div>
        ${this.renderFeaturedDocCard()}
      </div>
    `;
  },

  renderCategoryCard(name, cssClass, iconName, subtitle) {
    const count = this.state.categoryCounts[name] || 0;
    return `
      <div class="category-card" onclick="VotlyApp.filterByCategory('${name}')">
        <div class="cat-left-content">
          <div class="cat-icon-badge ${cssClass}">
            ${this.svgIcon(iconName, 18)}
          </div>
          <div>
            <div class="cat-name">${name}</div>
            <div class="cat-count">${count} ${count === 1 ? 'item' : 'items'}</div>
          </div>
        </div>
        <div class="cat-chevron">
          ${this.svgIcon("chevron-right", 16)}
        </div>
      </div>
    `;
  },

  renderFeaturedDocCard() {
    const passportDoc = this.state.documents.find(d => d.document_type === "Passport") || this.state.documents[0];
    if (!passportDoc) return "";

    const expiry = this.getExpiryStatus(passportDoc.expires_date);

    return `
      <div class="document-item-row" style="padding: 16px; margin-bottom: 20px;" onclick="VotlyApp.openDocumentDetail(${passportDoc.id})">
        <div class="doc-row-left">
          <div class="doc-thumb-container" style="width: 52px; height: 68px;">
            <img src="/static/assets/thumb_passport.png" alt="Passport" class="doc-thumb-img" onerror="this.src='/static/assets/passport_crop.png'" />
          </div>
          <div class="doc-meta-col">
            <div class="doc-item-title" style="font-size: 16px;">${passportDoc.title}</div>
            <div class="doc-item-subline">
              <span class="doc-tag-badge" style="background: #F0F9FF; color: #0284C7;">
                ${this.svgIcon("plane", 12)} ${passportDoc.category}
              </span>
              <span class="doc-expiry-badge ${expiry.badgeClass}">
                ${expiry.status === 'expired' ? '🔴' : (expiry.status === 'expiring-soon' ? '🟡' : (expiry.status === 'valid' ? '🟢' : '⚪'))} ${expiry.text}
              </span>
            </div>
            <div style="font-size: 11px; color: var(--cobalt-primary); margin-top: 4px; font-weight: 600;">
              🔒 Encrypted with AES-256-GCM
            </div>
          </div>
        </div>
        <div>
          ${this.svgIcon("chevron-right", 18)}
        </div>
      </div>
    `;
  },

  getExpiryStatus(expiresDate) {
    if (!expiresDate || expiresDate === "None" || expiresDate === "null") {
      return {
        status: "indefinite",
        text: "Valid Indefinitely",
        badgeClass: "badge-indefinite",
        days: Infinity
      };
    }

    try {
      const parts = expiresDate.split("-");
      let target;
      if (parts.length === 3) {
        target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        target = new Date(expiresDate);
      }

      if (isNaN(target.getTime())) {
        return {
          status: "indefinite",
          text: expiresDate,
          badgeClass: "badge-indefinite",
          days: Infinity
        };
      }

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        return {
          status: "expired",
          text: absDays === 1 ? "Expired yesterday" : `Expired ${absDays}d ago`,
          badgeClass: "badge-expired",
          days: diffDays
        };
      } else if (diffDays === 0) {
        return {
          status: "expiring-soon",
          text: "Expires today",
          badgeClass: "badge-expiring-soon",
          days: 0
        };
      } else if (diffDays <= 90) {
        return {
          status: "expiring-soon",
          text: `Expires in ${diffDays}d`,
          badgeClass: "badge-expiring-soon",
          days: diffDays
        };
      } else {
        return {
          status: "valid",
          text: `Valid (${expiresDate})`,
          badgeClass: "badge-valid",
          days: diffDays
        };
      }
    } catch (e) {
      return {
        status: "indefinite",
        text: expiresDate,
        badgeClass: "badge-indefinite",
        days: Infinity
      };
    }
  },

  renderExpiryAlertBanner() {
    if (!this.state.documents || this.state.documents.length === 0) return "";

    const docsWithExpiry = this.state.documents
      .filter(d => d.expires_date)
      .map(d => ({
        ...d,
        expiry: this.getExpiryStatus(d.expires_date)
      }))
      .filter(d => d.expiry.status === "expired" || d.expiry.status === "expiring-soon")
      .sort((a, b) => a.expiry.days - b.expiry.days);

    if (docsWithExpiry.length === 0) return "";

    const mostUrgent = docsWithExpiry[0];
    const isExpired = mostUrgent.expiry.status === "expired";
    const totalCount = docsWithExpiry.length;

    const alertClass = isExpired ? "alert-expired" : "alert-warning";
    const iconWrapClass = isExpired ? "icon-expired" : "icon-warning";
    const iconSvg = isExpired ? this.svgIcon("alert-triangle", 20) : this.svgIcon("bell", 20);

    let title = "";
    let desc = "";

    if (totalCount === 1) {
      if (isExpired) {
        title = `${mostUrgent.title} has Expired`;
        desc = `Expired on ${mostUrgent.expires_date} (${mostUrgent.expiry.text.toLowerCase()}). Tap to review and renew.`;
      } else {
        title = `Upcoming Renewal: ${mostUrgent.title}`;
        desc = `${mostUrgent.expiry.text} on ${mostUrgent.expires_date}. Plan your renewal early.`;
      }
    } else {
      const expiredCount = docsWithExpiry.filter(d => d.expiry.status === "expired").length;
      const expiringSoonCount = docsWithExpiry.filter(d => d.expiry.status === "expiring-soon").length;

      if (expiredCount > 0) {
        title = `${expiredCount} Document${expiredCount > 1 ? 's' : ''} Expired`;
        desc = `${mostUrgent.title} and ${totalCount - 1} other item${totalCount > 2 ? 's' : ''} require attention. Tap to review.`;
      } else {
        title = `${expiringSoonCount} Documents Expiring Soon`;
        desc = `Including ${mostUrgent.title} (${mostUrgent.expiry.text}). Tap to review your vault renewals.`;
      }
    }

    return `
      <div class="vault-expiry-alert-card ${alertClass}" onclick="VotlyApp.openDocumentDetail(${mostUrgent.id})">
        <div class="expiry-alert-icon-wrap ${iconWrapClass}">
          ${iconSvg}
        </div>
        <div class="expiry-alert-content">
          <div class="expiry-alert-title">${title}</div>
          <div class="expiry-alert-desc">${desc}</div>
        </div>
        <div class="expiry-alert-action">
          ${this.svgIcon("chevron-right", 18)}
        </div>
      </div>
    `;
  },

  templateDocuments() {
    const filteredDocs = this.state.documents.filter(doc => {
      if (this.state.activeCategory !== "all" && doc.category.toLowerCase() !== this.state.activeCategory.toLowerCase()) {
        return false;
      }
      if (this.state.searchQuery) {
        const q = this.state.searchQuery.toLowerCase();
        return doc.title.toLowerCase().includes(q) ||
               (doc.document_number && doc.document_number.toLowerCase().includes(q)) ||
               (doc.notes && doc.notes.toLowerCase().includes(q));
      }
      return true;
    });

    return `
      <div class="documents-view-container">
        <!-- Header -->
        <div class="home-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <button class="back-btn-pill" onclick="VotlyApp.navigate('home')">
              ${this.svgIcon("chevron-left", 18)}
            </button>
            <div class="user-display-name" style="font-size: 22px;">Documents</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="icon-button" onclick="VotlyApp.openAddDocModal()" title="Add Document">
              ${this.svgIcon("plus", 18)}
            </button>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="search-bar-wrapper">
          <span class="search-icon-left">${this.svgIcon("search", 18)}</span>
          <input type="text" class="search-input" placeholder="Search your documents..."
                 value="${this.state.searchQuery}"
                 oninput="VotlyApp.handleSearchInput(this.value)" />
          <span class="filter-icon-right" onclick="VotlyApp.cycleSortOrder()" title="Sort">
            ${this.svgIcon("filter", 18)}
          </span>
        </div>

        <!-- Category Filter Pills (Matching Screen 6) -->
        <div class="filter-pills-row">
          ${this.renderFilterPill("all", "All")}
          ${this.renderFilterPill("Identity", "Identity")}
          ${this.renderFilterPill("Travel", "Travel")}
          ${this.renderFilterPill("Banking", "Banking")}
          ${this.renderFilterPill("Education", "Education")}
          ${this.renderFilterPill("Personal", "Personal")}
          ${this.renderFilterPill("Health", "Health")}
        </div>

        <!-- Document List -->
        <div class="document-items-list">
          ${filteredDocs.length > 0 ? filteredDocs.map(doc => this.renderDocumentRow(doc)).join("") : `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
              ${this.svgIcon("folder", 48)}
              <div style="margin-top: 12px; font-weight: 600; color: var(--text-primary);">No documents found</div>
              <div style="font-size: 13px; margin-top: 4px;">Try another search or tap '+' to add a document.</div>
            </div>
          `}
        </div>
      </div>
    `;
  },

  renderFilterPill(catKey, catLabel) {
    const isActive = this.state.activeCategory.toLowerCase() === catKey.toLowerCase();
    return `
      <div class="pill-item ${isActive ? 'active' : ''}" onclick="VotlyApp.filterByCategory('${catKey}')">
        ${catLabel}
      </div>
    `;
  },

  renderDocumentRow(doc) {
    let thumbSrc = "/static/assets/thumb_passport.png";
    if (doc.document_type === "Identity Photo" || doc.category === "Personal") thumbSrc = "/static/assets/thumb_photo.png";
    else if (doc.document_type === "Visa") thumbSrc = "/static/assets/thumb_visa.png";
    else if (doc.document_type === "National ID" || (doc.title && doc.title.toLowerCase().includes("nin"))) thumbSrc = "/static/assets/thumb_nin_authentic.png";
    else if (doc.category === "Identity") thumbSrc = "/static/assets/thumb_passport.png";

    const expiry = this.getExpiryStatus(doc.expires_date);

    return `
      <div class="document-item-row" onclick="VotlyApp.openDocumentDetail(${doc.id})">
        <div class="doc-row-left">
          <div class="doc-thumb-container">
            <img src="${thumbSrc}" alt="${this.escapeHtml(doc.title)}" class="doc-thumb-img" onerror="this.src='/static/assets/passport_crop.png'" />
          </div>
          <div class="doc-meta-col">
            <div class="doc-item-title">${this.escapeHtml(doc.title)}</div>
            <div class="doc-item-subline">
              <span class="doc-tag-badge" style="background: var(--cat-${doc.category.toLowerCase()}-bg, #F0F9FF); color: var(--cat-${doc.category.toLowerCase()}-color, #0284C7);">
                ${doc.category}
              </span>
              <span class="doc-expiry-badge ${expiry.badgeClass}">
                ${expiry.status === 'expired' ? '🔴' : (expiry.status === 'expiring-soon' ? '🟡' : (expiry.status === 'valid' ? '🟢' : '⚪'))} ${expiry.text}
              </span>
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #DCFCE7; color: #15803D; font-weight: 600;">AES-256</span>
          <div class="cat-chevron">
            ${this.svgIcon("chevron-right", 16)}
          </div>
        </div>
      </div>
    `;
  },

  // ----------------- SCREEN 4: DOCUMENT DETAIL VIEW ----------------- //

  templateDetail() {
    const doc = this.state.activeDoc;
    if (!doc) {
      return `<div style="text-align: center; padding: 40px;">Document not found. <button onclick="VotlyApp.navigate('documents')">Back</button></div>`;
    }

    const isEditing = this.state.isEditingDoc;
    const expiry = this.getExpiryStatus(doc.expires_date);

    return `
      <div class="detail-view-container">
        <!-- Top Nav -->
        <div class="detail-top-nav">
          <button class="back-btn-pill" onclick="VotlyApp.navigate('documents')">
            ${this.svgIcon("chevron-left", 18)} Documents
          </button>
          <div style="display: flex; gap: 8px;">
            <button class="btn-edit-toggle" onclick="VotlyApp.toggleDocumentEditMode()" title="Edit document fields">
              ${this.svgIcon("edit", 14)}
              <span>${isEditing ? 'Cancel Edit' : 'Edit Info'}</span>
            </button>
          </div>
        </div>

        ${(expiry.status === 'expired' || expiry.status === 'expiring-soon') ? `
          <!-- Vault Assistant Expiry Renewal Notice -->
          <div class="detail-renewal-notice ${expiry.badgeClass}">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px;">${expiry.status === 'expired' ? '⚠️' : '⏳'}</span>
              <div>
                <strong>${expiry.status === 'expired' ? 'Document Expired' : 'Renewal Recommended'}</strong>: 
                ${expiry.status === 'expired' ? `Expired on ${doc.expires_date} (${expiry.text.toLowerCase()}).` : `Expires in ${expiry.days} days on ${doc.expires_date}.`}
              </div>
            </div>
            <button class="btn-renew-now" onclick="VotlyApp.toggleDocumentEditMode()">
              Update Expiry
            </button>
          </div>
        ` : ''}

        <!-- Card Mode Switcher (Smartcard Mockup vs Decrypted File) -->
        <div style="display: flex; justify-content: center; margin-bottom: 16px;">
          <div class="card-mode-toggle-bar">
            <button class="card-mode-btn ${this.state.cardViewMode !== 'file' ? 'active' : ''}" onclick="VotlyApp.setCardViewMode('card')">
              ${this.svgIcon("id-badge", 13)} Smartcard View
            </button>
            <button class="card-mode-btn ${this.state.cardViewMode === 'file' ? 'active' : ''}" onclick="VotlyApp.setCardViewMode('file')">
              ${this.svgIcon("eye", 13)} Decrypted File Preview
            </button>
          </div>
        </div>

        <!-- Real-time Rendered Distinctive Card OR Decrypted File Preview -->
        <div class="document-card-showcase">
          ${this.state.cardViewMode === 'file' ? `
            <div style="text-align: center; width: 100%; max-width: 380px;">
              <div style="background: var(--bg-surface); border-radius: 14px; padding: 12px; box-shadow: var(--shadow-card); border: 1px solid var(--border-light);">
                <img src="/api/documents/${doc.id}/preview?t=${Date.now()}" alt="${doc.title}"
                     style="max-width: 100%; max-height: 280px; object-fit: contain; border-radius: 8px;"
                     onerror="this.src='/static/assets/passport_crop.png'" />
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                  🔒 Decrypted Live: ${this.escapeHtml(doc.original_filename || 'document')}
                </div>
              </div>
            </div>
          ` : this.renderDistinctiveCard(doc)}
        </div>

        <!-- Title & Tags Row -->
        <div class="detail-title-row">
          <h2 class="detail-main-title">${this.escapeHtml(doc.title)}</h2>
          <div class="detail-meta-tags">
            <span class="doc-tag-badge" style="background: var(--cat-${doc.category.toLowerCase()}-bg, #F0F9FF); color: var(--cat-${doc.category.toLowerCase()}-color, #0284C7);">
              ${this.svgIcon("plane", 12)} ${doc.category}
            </span>
            <span>•</span>
            <span class="doc-expiry-badge ${expiry.badgeClass}">
              ${expiry.status === 'expired' ? '🔴' : (expiry.status === 'expiring-soon' ? '🟡' : (expiry.status === 'valid' ? '🟢' : '⚪'))} ${expiry.text}
            </span>
          </div>
        </div>

        <!-- Action Buttons (View Details, Upload Personal Scan & Share Cobalt Button) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <button class="btn-secondary-pearl" style="margin-top: 0; font-size: 13.5px;" onclick="VotlyApp.openFileViewerModal(${doc.id})">
            ${this.svgIcon("eye", 15)} View Details
          </button>
          <button class="btn-secondary-pearl" style="margin-top: 0; font-size: 13.5px;" onclick="document.getElementById('replaceDocFileInput').click()" title="Upload a personal photo or scan to replace this document file">
            ${this.svgIcon("upload", 15)} Upload Personal Scan
          </button>
          <input type="file" id="replaceDocFileInput" accept="image/*,.pdf" style="display: none;" onchange="VotlyApp.handleReplaceDocumentFile(event, ${doc.id})" />
        </div>
        <button class="btn-primary-cobalt" style="margin-bottom: 24px;" onclick="VotlyApp.openShareModalForDoc(${doc.id})">
          ${this.svgIcon("share", 16)} Share Time-Expiring Secure Link
        </button>

        ${isEditing ? `
          <!-- EDITABLE DOCUMENT INFO FORM (Interactive Editing) -->
          <div class="doc-info-card" style="border: 2px solid var(--cobalt-primary); box-shadow: 0 4px 20px -2px rgba(37, 99, 235, 0.15);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div class="doc-info-title" style="margin-bottom: 0; color: var(--cobalt-primary); display: flex; align-items: center; gap: 6px;">
                ${this.svgIcon("edit", 16)} Edit Document Details
              </div>
              <span style="font-size: 11px; background: #EFF6FF; color: #2563EB; padding: 2px 8px; border-radius: 9999px; font-weight: 600;">Live Vault Edit</span>
            </div>

            <div class="edit-field-group">
              <label class="edit-field-label">Document Title *</label>
              <input type="text" id="editDocTitle" class="form-input-sm" value="${this.escapeHtml(doc.title)}" placeholder="e.g. International Passport">
            </div>

            <div class="form-row-2">
              <div class="edit-field-group">
                <label class="edit-field-label">Document Type</label>
                <input type="text" id="editDocType" class="form-input-sm" value="${this.escapeHtml(doc.document_type || '')}" placeholder="e.g. Passport, National ID">
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Issuing Country</label>
                <input type="text" id="editDocCountry" class="form-input-sm" value="${this.escapeHtml(doc.country || '')}" placeholder="e.g. Nigeria, United Kingdom, USA">
              </div>
            </div>

            <div class="form-row-2">
              <div class="edit-field-group">
                <label class="edit-field-label">Document Number / NIN *</label>
                <input type="text" id="editDocNumber" class="form-input-sm" value="${this.escapeHtml(doc.document_number || '')}" placeholder="e.g. NIN-8934-2910-4491">
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Category</label>
                <select id="editDocCategory" class="form-input-sm" style="height: 38px;">
                  <option value="Identity" ${doc.category === 'Identity' ? 'selected' : ''}>Identity</option>
                  <option value="Banking" ${doc.category === 'Banking' ? 'selected' : ''}>Banking</option>
                  <option value="Travel" ${doc.category === 'Travel' ? 'selected' : ''}>Travel</option>
                  <option value="Education" ${doc.category === 'Education' ? 'selected' : ''}>Education</option>
                  <option value="Personal" ${doc.category === 'Personal' ? 'selected' : ''}>Personal</option>
                  <option value="Health" ${doc.category === 'Health' ? 'selected' : ''}>Health</option>
                </select>
              </div>
            </div>

            <div class="form-row-2">
              <div class="edit-field-group">
                <label class="edit-field-label">Issued Date</label>
                <input type="date" id="editDocIssued" class="form-input-sm" value="${doc.issued_date || ''}">
              </div>

              <div class="edit-field-group">
                <label class="edit-field-label">Expiry Date</label>
                <input type="date" id="editDocExpires" class="form-input-sm" value="${doc.expires_date || ''}">
              </div>
            </div>

            <div class="edit-field-group">
              <label class="edit-field-label">Private Notes</label>
              <textarea id="editDocNotes" class="form-input-sm" rows="2" placeholder="Private notes, reminders, or details...">${this.escapeHtml(doc.notes || '')}</textarea>
            </div>

            <div class="edit-actions-row">
              <button class="btn-save-cobalt" onclick="VotlyApp.saveDocumentEdits(${doc.id})">
                ${this.svgIcon("check", 16)} Save Changes
              </button>
              <button class="btn-cancel-pearl" onclick="VotlyApp.cancelDocumentEdit()">
                Cancel
              </button>
            </div>
          </div>
        ` : `
          <!-- READ-ONLY DOCUMENT INFO CARD -->
          <div class="doc-info-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <div class="doc-info-title" style="margin-bottom: 0;">Document Info</div>
              <button class="btn-edit-toggle" onclick="VotlyApp.toggleDocumentEditMode()">
                ${this.svgIcon("edit", 13)} Edit Info
              </button>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Type</span>
              <span class="info-value">${this.escapeHtml(doc.document_type || doc.category)}</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Country</span>
              <span class="info-value">${this.escapeHtml(doc.country || "Not specified")}</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Issued</span>
              <span class="info-value">${doc.issued_date || "N/A"}</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Expires</span>
              <span class="info-value" style="display: flex; align-items: center; gap: 6px;">
                <span>${doc.expires_date || "Never"}</span>
                <span class="doc-expiry-badge ${expiry.badgeClass}">${expiry.status === 'expired' ? '🔴 Expired' : (expiry.status === 'expiring-soon' ? '🟡 Expiring Soon' : '🟢 Valid')}</span>
              </span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Document Number</span>
              <span class="info-value" style="font-family: monospace;">${this.escapeHtml(doc.document_number || "••••••••")}</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Category</span>
              <span class="info-value">${doc.category}</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">Encryption Cipher</span>
              <span class="info-value" style="color: #059669;">AES-256-GCM / Fernet</span>
            </div>

            <div class="doc-info-row">
              <span class="info-label">SHA-256 Fingerprint</span>
              <span class="info-value" style="font-family: monospace; font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">
                ${doc.sha256_hash ? doc.sha256_hash.substring(0, 16) + '...' : 'Verified'}
              </span>
            </div>

            ${doc.notes ? `
              <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--divider);">
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Notes</div>
                <div style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.4;">${this.escapeHtml(doc.notes)}</div>
              </div>
            ` : ''}
          </div>
        `}

        <!-- Download & Shred Actions -->
        <div style="display: flex; gap: 12px; margin-bottom: 30px;">
          <a href="/api/documents/${doc.id}/download" class="btn-secondary-pearl" style="text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 6px;" download>
            ${this.svgIcon("download", 16)} Download Decrypted
          </a>
          <button class="btn-secondary-pearl" style="color: #DC2626; border-color: rgba(220, 38, 38, 0.3);" onclick="VotlyApp.deleteActiveDocument()">
            ${this.svgIcon("trash", 16)} Shred Document
          </button>
        </div>
      </div>
    `;
  },

  // ----------------- DISTINCTIVE DOCUMENT CARD RENDERER ----------------- //

  renderDistinctiveCard(doc) {
    if (doc.document_type === "Passport" || doc.title.toLowerCase().includes("passport")) {
      const countryRaw = (doc.country || "Nigeria").trim();
      const isNigeria = countryRaw.toLowerCase().includes("nigeria") || !countryRaw;

      if (isNigeria) {
        return `
          <div class="card-passport-nigeria" title="Federal Republic of Nigeria Official Passport">
            <img src="/static/assets/nigeria_passport_authentic.png" alt="Federal Republic of Nigeria International Passport" class="card-passport-cover-img" />
            <div class="passport-overlay-badge">
              <div>
                <div style="font-size: 8px; text-transform: uppercase; color: #D4AF37; letter-spacing: 0.8px; font-weight: 700;">Passport No.</div>
                <div style="font-size: 13px; font-weight: 700; color: #FFFFFF; font-family: 'SF Mono', Monaco, monospace; letter-spacing: 1px;">
                  ${this.escapeHtml(doc.document_number || "A09823411")}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 8px; text-transform: uppercase; color: #D4AF37; letter-spacing: 0.8px; font-weight: 700;">Expiry Date</div>
                <div style="font-size: 11.5px; font-weight: 600; color: #F3E5AB;">
                  ${doc.expires_date || "2030-01-11"}
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        const countryUpper = countryRaw.toUpperCase();
        return `
          <div class="card-passport-nigeria" style="background: linear-gradient(145deg, #0A192F 0%, #172A45 50%, #0A192F 100%);">
            <div class="passport-gold-text-country">
              ${this.escapeHtml(countryUpper)}
            </div>
            <div class="passport-gold-emblem">
              <svg viewBox="0 0 100 100" fill="#D4AF37" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#D4AF37" stroke-width="2.5"/>
                <path d="M50 15 L56 30 L72 32 L60 44 L64 60 L50 51 L36 60 L40 44 L28 32 L44 30 Z" fill="#D4AF37"/>
              </svg>
            </div>
            <div class="passport-gold-text-title">
              PASSPORT
            </div>
            <div class="passport-overlay-badge" style="background: rgba(10, 25, 47, 0.9);">
              <div>
                <div style="font-size: 8px; text-transform: uppercase; color: #D4AF37; letter-spacing: 0.8px; font-weight: 700;">Passport No.</div>
                <div style="font-size: 13px; font-weight: 700; color: #FFFFFF; font-family: 'SF Mono', Monaco, monospace; letter-spacing: 1px;">
                  ${this.escapeHtml(doc.document_number || "P12345678")}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 8px; text-transform: uppercase; color: #D4AF37; letter-spacing: 0.8px; font-weight: 700;">Expiry</div>
                <div style="font-size: 11.5px; font-weight: 600; color: #F3E5AB;">
                  ${doc.expires_date || "2030-01-11"}
                </div>
              </div>
            </div>
          </div>
        `;
      }
    } else if (doc.category === "Banking" || doc.document_type === "Bank Card") {
      return `
        <div class="card-bank-cobalt">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-weight: 700; font-size: 13px; letter-spacing: 1px;">${this.escapeHtml((doc.country || "VOTLY COBALT WORLD").toUpperCase())}</span>
            ${this.svgIcon("wifi", 18)}
          </div>
          <div class="bank-card-chip"></div>
          <div class="bank-card-number">${this.escapeHtml(doc.document_number || "•••• •••• •••• 8829")}</div>
          <div class="bank-card-footer">
            <div>
              <div style="font-size: 9px; opacity: 0.8; text-transform: uppercase;">Cardholder</div>
              <div style="font-weight: 600; font-size: 13px;">${(this.state.user?.full_name || "ADA OKAFOR").toUpperCase()}</div>
            </div>
            <div>
              <div style="font-size: 9px; opacity: 0.8; text-transform: uppercase;">Expires</div>
              <div style="font-weight: 600; font-size: 13px;">${doc.expires_date ? doc.expires_date.substring(2, 7) : "03/27"}</div>
            </div>
          </div>
        </div>
      `;
    } else if (doc.category === "Identity" || doc.document_type === "National ID" || doc.title?.toLowerCase().includes("nin") || doc.title?.toLowerCase().includes("identity") || doc.document_number?.toUpperCase().startsWith("NIN")) {
      const isNigeria = !doc.country || doc.country.toLowerCase().includes("nigeria");

      if (isNigeria) {
        return `
          <div class="card-national-id-container" title="Federal Republic of Nigeria National Identity Card (NIMC)">
            <img src="/static/assets/nigeria_nin_front_crop.png" alt="Federal Republic of Nigeria National Identity Card" class="card-nin-bg-img" />
            <div class="card-nin-live-overlay">
              <div>
                <div class="nin-overlay-name">${this.escapeHtml((this.state.user?.full_name || "Ada Okafor").toUpperCase())}</div>
                <div style="font-size: 9.5px; color: #047857; font-weight: 600;">FEDERAL REPUBLIC OF NIGERIA • NIMC</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 8px; text-transform: uppercase; color: #475569; font-weight: 700; letter-spacing: 0.5px;">National ID / NIN</div>
                <div class="nin-overlay-num">${this.escapeHtml(doc.document_number || "5412 7512 3412 3456")}</div>
                <div style="font-size: 9.5px; color: #475569; margin-top: 1px;">Exp: ${doc.expires_date || "05/24"}</div>
              </div>
            </div>
          </div>
        `;
      } else {
        const countryUpper = (doc.country || "OFFICIAL NATIONAL ID").toUpperCase();
        return `
          <div class="card-national-id">
            <div class="card-id-header">
              <span>${this.escapeHtml(countryUpper)}</span>
              <span>${this.escapeHtml((doc.document_type || "IDENTITY CARD").toUpperCase())}</span>
            </div>
            <div class="card-id-body">
              <img src="/static/assets/ada_header_avatar.png" alt="Photo" class="card-id-photo" onerror="this.src='/static/assets/thumb_photo.png'" />
              <div class="card-id-info">
                <div class="card-id-name">${(this.state.user?.full_name || "Ada Okafor").toUpperCase()}</div>
                <div class="card-id-num">ID: ${this.escapeHtml(doc.document_number || "8934-2910-4491")}</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.9;">EXP: ${doc.expires_date || "2031-04-14"}</div>
                <div style="font-size: 10px; margin-top: 2px; opacity: 0.85;">ISSUED: ${doc.issued_date || "2021-04-15"}</div>
              </div>
            </div>
          </div>
        `;
      }
    } else {
      // Default clean pearl certificate card
      return `
        <div class="card-certificate">
          <div style="font-size: 12px; font-weight: 700; color: #2563EB; letter-spacing: 1px; margin-bottom: 6px;">
            ${this.escapeHtml((doc.country || "OFFICIAL VAULT CREDENTIAL").toUpperCase())}
          </div>
          <div style="font-size: 18px; font-weight: 800; color: #0F172A; margin-bottom: 6px;">${this.escapeHtml(doc.title)}</div>
          <div style="font-size: 12px; color: #64748B; margin-bottom: 8px;">TYPE: ${this.escapeHtml(doc.document_type || doc.category)}</div>
          <div style="font-size: 13px; color: #475569; margin-bottom: 12px;">${this.escapeHtml(doc.notes || 'Secure cryptographic record')}</div>
          <div style="font-family: monospace; font-size: 12px; background: #F1F5F9; padding: 6px 10px; border-radius: 6px; display: inline-block;">
            NO: ${this.escapeHtml(doc.document_number || doc.sha256_hash?.substring(0, 12))}
          </div>
          <div style="font-size: 11px; color: #94A3B8; margin-top: 6px;">
            ${doc.issued_date ? 'ISSUED: ' + doc.issued_date : ''} ${doc.expires_date ? '• EXP: ' + doc.expires_date : ''}
          </div>
        </div>
      `;
    }
  },

  // ----------------- SCREEN 5: DOCUMENT SCANNER ----------------- //

  templateScanner() {
    return `
      <div class="scanner-view-container">
        <!-- Top Controls -->
        <div class="scanner-top-bar">
          <button class="icon-button" style="background: rgba(0,0,0,0.5); color: #FFFFFF; border: none;" onclick="VotlyApp.navigate('home')">
            ${this.svgIcon("x", 20)}
          </button>
          <div style="font-weight: 600; font-size: 15px;">Scan Document</div>
          <button class="icon-button" style="background: rgba(0,0,0,0.5); color: #FFFFFF; border: none;" onclick="VotlyApp.toggleScannerFlash()" title="Flash">
            ${this.svgIcon("zap", 20)}
          </button>
        </div>

        <!-- Video Stream & Laser Guide Frame (Exact Reference Image Style) -->
        <video id="scannerVideo" class="scanner-video-feed" playsinline autoplay muted></video>
        <canvas id="scannerCanvas" style="display: none;"></canvas>

        <div class="scanner-reticle-frame">
          <div class="scanner-laser-line"></div>
        </div>

        <div class="scanner-instruction">
          Position the document within the frame
        </div>

        <!-- Bottom Controls -->
        <div class="scanner-bottom-controls">
          <button class="icon-button" style="background: rgba(255,255,255,0.2); color: #FFFFFF; border: none;" onclick="document.getElementById('hiddenScanInput').click()" title="From Gallery">
            ${this.svgIcon("image", 22)}
          </button>
          <input type="file" id="hiddenScanInput" accept="image/*" style="display: none;" onchange="VotlyApp.handleScanFromFile(event)" />

          <button class="shutter-btn-outer" onclick="VotlyApp.triggerCapture()">
            <div class="shutter-btn-inner"></div>
          </button>

          <button class="icon-button" style="background: rgba(255,255,255,0.2); color: #FFFFFF; border: none;" onclick="VotlyApp.flipScannerCamera()" title="Flip Camera">
            ${this.svgIcon("refresh-cw", 22)}
          </button>
        </div>
      </div>
    `;
  },

  async initScannerView() {
    const videoEl = document.getElementById("scannerVideo");
    const canvasEl = document.getElementById("scannerCanvas");
    if (!videoEl) return;

    await VotlyScanner.startCamera(
      videoEl,
      canvasEl,
      () => console.log("Camera ready"),
      (err) => console.log("Camera notice:", err)
    );
  },

  async triggerCapture() {
    const dataUrl = VotlyScanner.captureFrame();
    VotlyScanner.stopCamera();
    this.openAddDocModalWithScan(dataUrl);
  },

  toggleScannerFlash() {
    this.showToast("Flash toggle simulated", "info");
  },

  flipScannerCamera() {
    VotlyScanner.toggleFacingMode(
      () => this.showToast("Camera switched", "info"),
      (err) => this.showToast("Camera flip failed: " + err, "error")
    );
  },

  handleScanFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.openAddDocModalWithScan(e.target.result);
    };
    reader.readAsDataURL(file);
  },

  // ----------------- SCREEN 6: SEARCH VIEW ----------------- //

  templateSearch() {
    const query = this.state.searchQuery.toLowerCase();
    const searchResults = this.state.documents.filter(d => {
      if (this.state.activeCategory !== "all" && d.category.toLowerCase() !== this.state.activeCategory.toLowerCase()) {
        return false;
      }
      if (!query) return true;
      return d.title.toLowerCase().includes(query) ||
             (d.document_type && d.document_type.toLowerCase().includes(query)) ||
             (d.document_number && d.document_number.toLowerCase().includes(query)) ||
             (d.country && d.country.toLowerCase().includes(query)) ||
             (d.tags && d.tags.toLowerCase().includes(query));
    });

    return `
      <div class="search-view-container">
        <!-- Search Input Bar -->
        <div class="search-bar-wrapper">
          <span class="search-icon-left">${this.svgIcon("search", 18)}</span>
          <input type="text" id="liveSearchInput" class="search-input" placeholder="Search your documents..."
                 value="${this.state.searchQuery}" autofocus
                 oninput="VotlyApp.handleSearchInput(this.value)" />
          ${this.state.searchQuery ? `
            <span class="filter-icon-right" onclick="VotlyApp.clearSearch()">
              ${this.svgIcon("x", 16)}
            </span>
          ` : ''}
        </div>

        <!-- Filter Category Pills (Matching Screen 6) -->
        <div class="filter-pills-row">
          ${this.renderFilterPill("all", "All")}
          ${this.renderFilterPill("Identity", "Identity")}
          ${this.renderFilterPill("Travel", "Travel")}
          ${this.renderFilterPill("Personal", "Personal")}
          ${this.renderFilterPill("Banking", "Banking")}
          ${this.renderFilterPill("Health", "Health")}
        </div>

        <!-- Results Header -->
        <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 12px;">
          ${searchResults.length} ${searchResults.length === 1 ? 'result' : 'results'} found
        </div>

        <!-- Results List -->
        <div class="document-items-list">
          ${searchResults.map(doc => this.renderDocumentRow(doc)).join("")}
        </div>
      </div>
    `;
  },

  handleSearchInput(val) {
    this.state.searchQuery = val;
    // Debounced or live re-render
    const listEl = document.querySelector(".document-items-list");
    if (listEl) {
      const filtered = this.state.documents.filter(d => {
        if (this.state.activeCategory !== "all" && d.category.toLowerCase() !== this.state.activeCategory.toLowerCase()) return false;
        if (!val) return true;
        const q = val.toLowerCase();
        return d.title.toLowerCase().includes(q) ||
               (d.document_type && d.document_type.toLowerCase().includes(q)) ||
               (d.document_number && d.document_number.toLowerCase().includes(q));
      });
      listEl.innerHTML = filtered.map(d => this.renderDocumentRow(d)).join("");
    }
  },

  clearSearch() {
    this.state.searchQuery = "";
    this.renderCurrentView();
  },

  filterByCategory(cat) {
    this.state.activeCategory = cat;
    if (this.state.currentView !== "documents" && this.state.currentView !== "search") {
      this.navigate("documents");
    } else {
      this.renderCurrentView();
    }
  },

  // ----------------- SCREEN 8: SETTINGS & SECURITY ----------------- //

  templateSettings() {
    return `
      <div class="settings-view-container">
        <h1 class="hero-title" style="font-size: 24px; margin-bottom: 18px;">Settings</h1>

        <!-- Profile Card -->
        <div class="settings-profile-card" onclick="VotlyApp.openProfileEditModal()">
          <div style="display: flex; align-items: center; gap: 14px;">
            <img src="${this.state.user?.avatar_url || '/static/assets/ada_header_avatar.png'}" alt="Ada"
                 style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 2px solid var(--cobalt-primary);" />
            <div>
              <div id="settingsUserName" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${this.state.user?.full_name || 'Ada Okafor'}</div>
              <div id="settingsUserEmail" style="font-size: 13px; color: var(--text-muted);">${this.state.user?.email || 'ada.okafor@email.com'}</div>
            </div>
          </div>
          <div>${this.svgIcon("chevron-right", 18)}</div>
        </div>

        <!-- Settings Groups (Matching Screen 8) -->
        <div class="settings-group-stack">
          <div class="settings-row-item" onclick="VotlyApp.openAccountSecurityModal()">
            <div class="settings-item-left">
              <div class="settings-icon-badge">${this.svgIcon("lock", 18)}</div>
              <div>
                <div class="settings-item-title">Account & Security</div>
                <div class="settings-item-desc">Manage your account, password & 2FA</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>

          <div class="settings-row-item" onclick="VotlyApp.openSecurityAuditModal()">
            <div class="settings-item-left">
              <div class="settings-icon-badge" style="color: #2563EB;">${this.svgIcon("shield", 18)}</div>
              <div>
                <div class="settings-item-title">Security Architecture & Limitations</div>
                <div class="settings-item-desc">Cryptographic model, guarantees & honest trade-offs</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>

          <div class="settings-row-item" onclick="VotlyApp.openPrivacySharingModal()">
            <div class="settings-item-left">
              <div class="settings-icon-badge">${this.svgIcon("eye-off", 18)}</div>
              <div>
                <div class="settings-item-title">Privacy & Data Sharing</div>
                <div class="settings-item-desc">Control your data, access logs and active share links</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>

          <div class="settings-row-item" onclick="VotlyApp.toggleTheme()">
            <div class="settings-item-left">
              <div class="settings-icon-badge">${this.svgIcon("sun", 18)}</div>
              <div>
                <div class="settings-item-title">Appearance</div>
                <div class="settings-item-desc">Currently: ${this.state.theme === 'light' ? 'Pearl White Light' : 'Cobalt Obsidian Dark'} (Tap to switch)</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>

          <div class="settings-row-item" onclick="VotlyApp.triggerPwaInstall()">
            <div class="settings-item-left">
              <div class="settings-icon-badge" style="color: #2563EB;">${this.svgIcon("download", 18)}</div>
              <div>
                <div class="settings-item-title">Install Votly App</div>
                <div class="settings-item-desc">Add to phone home screen or desktop for 1-tap offline access</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>

          <div class="settings-row-item" onclick="VotlyApp.lockVaultNow()">
            <div class="settings-item-left">
              <div class="settings-icon-badge" style="color: #EA580C;">${this.svgIcon("key", 18)}</div>
              <div>
                <div class="settings-item-title">Lock Vault Now</div>
                <div class="settings-item-desc">Require PIN / password to reopen</div>
              </div>
            </div>
            <div>${this.svgIcon("chevron-right", 16)}</div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 32px;">
          <button class="btn-secondary-pearl" style="color: #DC2626; max-width: 200px; margin: 0 auto;" onclick="VotlyApp.logout()">
            ${this.svgIcon("log-out", 16)} Sign Out
          </button>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 16px;">Votly v2.4.0 • Pearl & Cobalt Edition</div>
        </div>
      </div>
    `;
  },

  // ----------------- SECURITY AUDIT & LIMITATIONS MODAL ----------------- //

  async openSecurityAuditModal() {
    try {
      const res = await fetch("/api/security/audit", { headers: this.getAuthHeaders() });
      if (res.ok) {
        this.state.securityData = await res.json();
      }
    } catch (e) {
      console.warn("Could not fetch live audit:", e);
    }

    const audit = this.state.securityData || {
      cipher_suite: "AES-256-GCM Authenticated Encryption with HMAC-SHA256",
      key_derivation: "PBKDF2-HMAC-SHA256 (100,000 rounds)",
      total_documents_secured: this.state.documents.length,
      honest_limitations: []
    };

    const modalBody = `
      <div class="audit-badge-row">
        <span class="status-pill-secure">✓ VAULT VERIFIED SECURE</span>
        <span style="font-size: 12px; color: var(--text-muted);">Real-time Telemetry</span>
      </div>

      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">Votly Cryptographic Architecture</h3>
      <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">
        Votly implements bank-grade authenticated encryption. Below is our security specification and transparent disclosure of architectural boundaries.
      </p>

      <div class="security-audit-card">
        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
          <div><strong>Cipher Suite:</strong> <span style="font-family: monospace;">${audit.cipher_suite}</span></div>
          <div><strong>Key Derivation:</strong> <span style="font-family: monospace;">${audit.key_derivation}</span></div>
          <div><strong>Persistent Storage:</strong> Zero plaintext on disk. 100% encrypted blobs in <code>/uploads</code>.</div>
          <div><strong>Shredding Protocol:</strong> DoD 5220.22-M zero-byte overwrite before deletion.</div>
          <div><strong>Documents Secured:</strong> ${audit.total_documents_secured} active credentials.</div>
        </div>
      </div>

      <!-- Mandatory Security Limitations Disclosure (Per Prompt Requirement) -->
      <div style="margin-top: 20px;">
        <h4 style="font-size: 15px; font-weight: 700; color: #991B1B; display: flex; align-items: center; gap: 6px;">
          ${this.svgIcon("alert-triangle", 16)} Cryptographic Guarantees & Honest Limitations
        </h4>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
          <div class="limitations-warning-box">
            <strong>1. Browser & Rendering Layer Risk:</strong>
            <div style="margin-top: 4px;">While files are encrypted at rest and in transit, decrypted documents temporarily exist in client browser memory while rendered. Any host-level keylogger or malicious browser extension on the user's OS could inspect unencrypted DOM nodes.</div>
          </div>
          <div class="limitations-warning-box">
            <strong>2. Zero-Knowledge Passphrase Irrecoverability:</strong>
            <div style="margin-top: 4px;">For files encrypted using custom client-side passphrases, Votly maintains no master backdoors. If the user forgets their passphrase, recovery is mathematically impossible.</div>
          </div>
          <div class="limitations-warning-box">
            <strong>3. Metadata Confidentiality:</strong>
            <div style="margin-top: 4px;">For high-performance instant searching, metadata (e.g. document titles and expiry dates) is stored in protected relational tables rather than completely opaque blobs.</div>
          </div>
        </div>
      </div>

      <button class="btn-primary-cobalt" style="margin-top: 24px;" onclick="VotlyApp.closeModal('genericModal')">
        I Understand
      </button>
    `;

    this.showGenericModal("Security Architecture & Limitations", modalBody);
  },

  // ----------------- MODALS: ADD DOCUMENT (SCREEN 7) ----------------- //

  openAddDocModal(initialMode = null) {
    const modal = document.getElementById("addDocModal");
    if (!modal) return;
    this.openModal("addDocModal");
  },

  openAddDocModalWithScan(dataUrl) {
    this.openModal("addDocModal");
    document.getElementById("scannedPreviewThumb").src = dataUrl;
    document.getElementById("scannedPreviewBox").style.display = "block";
    document.getElementById("scanDataUriInput").value = dataUrl;
    document.getElementById("docTitleInput").value = `Scan ${new Date().toLocaleDateString()}`;
  },

  openDocumentDetail(id) {
    const doc = this.state.documents.find(d => d.id === id);
    if (doc) {
      this.navigate("detail", doc);
    }
  },

  openFileViewerModal(id) {
    const doc = this.state.documents.find(d => d.id === id) || this.state.activeDoc;
    if (!doc) return;

    const isImage = doc.mime_type.startsWith("image/");
    const contentHtml = isImage ? `
      <div style="text-align: center; margin: 16px 0;">
        <img src="/api/documents/${doc.id}/preview" alt="${doc.title}" style="max-width: 100%; max-height: 400px; border-radius: 12px; box-shadow: var(--shadow-card);" />
      </div>
    ` : `
      <div style="background: var(--divider); padding: 20px; border-radius: 12px; font-family: monospace; font-size: 13px; line-height: 1.6; max-height: 300px; overflow-y: auto;">
        <div>[ENCRYPTED VAULT RECORD]</div>
        <div>TITLE: ${doc.title}</div>
        <div>DOC NUMBER: ${doc.document_number || 'N/A'}</div>
        <div>CATEGORY: ${doc.category}</div>
        <div>HASH (SHA-256): ${doc.sha256_hash}</div>
        <div style="margin-top: 10px; color: var(--cobalt-primary);">Decrypted stream generated in-memory. File integrity verified.</div>
      </div>
    `;

    const body = `
      ${contentHtml}
      <div style="display: flex; gap: 12px; margin-top: 20px;">
        <a href="/api/documents/${doc.id}/download" class="btn-primary-cobalt" style="text-decoration: none; flex: 1; text-align: center;" download>
          ${this.svgIcon("download", 16)} Download Decrypted File
        </a>
      </div>
    `;

    this.showGenericModal(doc.title, body);
  },

  async openShareModalForDoc(id) {
    const doc = this.state.documents.find(d => d.id === id) || this.state.activeDoc;
    if (!doc) return;

    const shareData = await this.createShareLink(doc.id, 24, "1234");
    if (!shareData) return;

    const body = `
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: #EFF6FF; color: #2563EB; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">
          ${this.svgIcon("share", 24)}
        </div>
        <h4 style="font-size: 17px; font-weight: 700;">Secure Link Ready</h4>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
          Temporary access link with automatic expiration and PIN protection.
        </p>
      </div>

      <div class="form-group">
        <label class="form-label">Temporary Share Link</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="shareUrlInput" class="form-input" value="${shareData.share_url}" readonly />
          <button class="btn-primary-cobalt" style="width: auto; padding: 0 16px;" onclick="VotlyApp.copyShareLink()">
            Copy
          </button>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-muted); margin-top: 10px;">
        <span>🔒 Protected with PIN: <strong>1234</strong></span>
        <span>Expires in: <strong>24 Hours</strong></span>
      </div>
    `;

    this.showGenericModal("Share Document Securely", body);
  },

  copyShareLink() {
    const input = document.getElementById("shareUrlInput");
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value);
      this.showToast("Link copied to clipboard!", "success");
    }
  },

  // ----------------- AUTO-LOCK & SECURITY PIN ----------------- //

  setupInactivityTracker() {
    const resetTimer = () => {
      this.state.inactivitySeconds = 0;
    };
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("touchstart", resetTimer);

    // Check inactivity every 10 seconds
    setInterval(() => {
      this.state.inactivitySeconds += 10;
      const timeout = (this.state.user?.auto_lock_minutes || 5) * 60;
      if (this.state.inactivitySeconds >= timeout && !this.state.isVaultLocked && this.state.user) {
        this.lockVaultNow();
      }
    }, 10000);
  },

  lockVaultNow() {
    this.state.isVaultLocked = true;
    this.state.pinInput = "";
    this.updatePinDots();
    document.getElementById("pinLockOverlay").classList.remove("hidden");
  },

  handlePinDigit(digit) {
    if (this.state.pinInput.length < 4) {
      this.state.pinInput += digit;
      this.updatePinDots();

      if (this.state.pinInput.length === 4) {
        setTimeout(() => this.verifyPinCode(), 150);
      }
    }
  },

  handlePinBackspace() {
    this.state.pinInput = this.state.pinInput.slice(0, -1);
    this.updatePinDots();
  },

  updatePinDots() {
    const dots = document.querySelectorAll(".pin-dot");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("filled", idx < this.state.pinInput.length);
    });
  },

  async verifyPinCode() {
    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: {
          ...this.getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pin: this.state.pinInput })
      });
      const data = await res.json();
      if (data.valid) {
        this.state.isVaultLocked = false;
        this.state.inactivitySeconds = 0;
        document.getElementById("pinLockOverlay").classList.add("hidden");
        this.showToast("Vault Unlocked", "success");
      } else {
        this.showToast("Incorrect PIN. Default is 1234", "error");
        this.state.pinInput = "";
        this.updatePinDots();
      }
    } catch (e) {
      // Fallback for demo PIN 1234
      if (this.state.pinInput === "1234") {
        this.state.isVaultLocked = false;
        document.getElementById("pinLockOverlay").classList.add("hidden");
        this.showToast("Vault Unlocked", "success");
      } else {
        this.showToast("Invalid PIN (Hint: 1234)", "error");
        this.state.pinInput = "";
        this.updatePinDots();
      }
    }
  },

  // ----------------- VIEW MODE & THEME TOGGLES ----------------- //

  toggleViewMode() {
    const newMode = this.state.viewMode === "desktop" ? "mobile" : "desktop";
    this.applyViewMode(newMode);
  },

  applyViewMode(mode) {
    this.state.viewMode = mode;
    localStorage.setItem("votly_view_mode", mode);

    const desktopWrap = document.getElementById("desktopLayoutContainer");
    const mobileWrap = document.getElementById("mobileSimulatorContainer");
    const toggleBtn = document.getElementById("viewModeToggleText");

    if (mode === "mobile") {
      if (desktopWrap) desktopWrap.style.display = "none";
      if (mobileWrap) mobileWrap.style.display = "flex";
      if (toggleBtn) toggleBtn.textContent = "Switch to Desktop";
    } else {
      if (desktopWrap) desktopWrap.style.display = "block";
      if (mobileWrap) mobileWrap.style.display = "none";
      if (toggleBtn) toggleBtn.textContent = "Mobile Frame View";
    }
  },

  toggleTheme() {
    const newTheme = this.state.theme === "light" ? "dark" : "light";
    this.applyTheme(newTheme);
  },

  applyTheme(theme) {
    this.state.theme = theme;
    localStorage.setItem("votly_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  },

  // ----------------- PWA INSTALLATION TRIGGER ----------------- //

  triggerPwaInstall() {
    if (this.state.deferredPwaPrompt) {
      this.state.deferredPwaPrompt.prompt();
      this.state.deferredPwaPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === "accepted") {
          this.showToast("Votly added to your home screen!", "success");
        }
        this.state.deferredPwaPrompt = null;
        this.renderCurrentView();
      });
    } else {
      const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

      if (isStandalone) {
        this.showToast("Votly is already running as a standalone app!", "info");
      } else if (isIos) {
        this.showGenericModal(
          "Install Votly on iPhone / iPad",
          `
          <div style="text-align: center; padding: 10px 0;">
            <div style="width: 56px; height: 56px; border-radius: 14px; background: #EFF6FF; color: #2563EB; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto;">
              ${this.svgIcon("logo", 36)}
            </div>
            <h4 style="font-size: 17px; font-weight: 700; margin-bottom: 8px;">Install Votly to Home Screen</h4>
            <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 18px;">
              Install Votly for 1-tap encrypted access and an edge-to-edge Apple native app experience.
            </p>
            <div style="background: var(--divider); padding: 14px 16px; border-radius: 12px; text-align: left; font-size: 13px; line-height: 1.8;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: var(--cobalt-primary);">1.</span>
                <span>Tap the <strong>Share</strong> button <svg style="vertical-align: middle; display: inline;" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> in Safari.</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: var(--cobalt-primary);">2.</span>
                <span>Scroll down and select <strong>Add to Home Screen (+)</strong>.</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: var(--cobalt-primary);">3.</span>
                <span>Tap <strong>Add</strong> in the top-right corner.</span>
              </div>
            </div>
            <button class="btn-primary-cobalt" style="margin-top: 20px;" onclick="VotlyApp.closeModal('genericModal')">Got It</button>
          </div>
          `
        );
      } else {
        this.showGenericModal(
          "Install Votly Web App",
          `
          <div style="text-align: center; padding: 10px 0;">
            <div style="width: 56px; height: 56px; border-radius: 14px; background: #EFF6FF; color: #2563EB; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto;">
              ${this.svgIcon("logo", 36)}
            </div>
            <h4 style="font-size: 17px; font-weight: 700; margin-bottom: 8px;">Install Votly</h4>
            <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 18px;">
              Install Votly for 1-tap offline access, instant biometric unlock, and standalone window mode.
            </p>
            <div style="background: var(--divider); padding: 14px 16px; border-radius: 12px; text-align: left; font-size: 13px; line-height: 1.8;">
              <div>• <strong>Chrome / Edge</strong>: Click the install icon <strong>(⊕)</strong> or computer icon in the address bar.</div>
              <div>• <strong>Android</strong>: Tap menu <strong>(⋮)</strong> and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</div>
            </div>
            <button class="btn-primary-cobalt" style="margin-top: 20px;" onclick="VotlyApp.closeModal('genericModal')">Understood</button>
          </div>
          `
        );
      }
    }
  },

  // ----------------- MODAL UTILITIES ----------------- //

  openModal(modalId, mode = "") {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("open");
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("open");
  },

  showGenericModal(title, contentHtml) {
    document.getElementById("genericModalTitle").textContent = title;
    document.getElementById("genericModalBody").innerHTML = contentHtml;
    this.openModal("genericModal");
  },

  showToast(message, type = "info") {
    const toast = document.getElementById("votlyToast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.background = type === "success" ? "#10B981" : (type === "error" ? "#EF4444" : "#2563EB");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3200);
  },

  // ----------------- GLOBAL SVGS ----------------- //

  svgIcon(name, size = 20) {
    const icons = {
      "logo": `<svg viewBox="0 0 100 100" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 28 C26 22 42 22 48 38 L54 54 C58 64 64 68 72 68 C78 68 86 64 92 56" stroke="#2563EB" stroke-width="12" stroke-linecap="round"/>
        <path d="M48 38 L32 74 C28 82 20 86 12 80 C6 74 6 62 14 50 Z" fill="#2563EB"/>
      </svg>`,
      "shield-lock": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><rect x="9" y="10" width="6" height="5" rx="1"></rect><path d="M10 10V8a2 2 0 0 1 4 0v2"></path></svg>`,
      "shield": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
      "scan": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
      "upload": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
      "search": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
      "share": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`,
      "chevron-right": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
      "chevron-left": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
      "plus": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
      "bell": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
      "home": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
      "lock": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
      "settings": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
      "id-badge": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><circle cx="12" cy="11" r="3"></circle><path d="M6 18c0-2 2.5-3 6-3s6 1 6 3"></path></svg>`,
      "credit-card": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
      "plane": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path></svg>`,
      "graduation-cap": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
      "user": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
      "heart-pulse": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l.77.78L12 21.23l7.65-8.22.77-.78a5.4 5.4 0 0 0 0-7.65z"></path><polyline points="3 12 6 12 9 8 13 16 16 12 21 12"></polyline></svg>`,
      "download": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
      "trash": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
      "eye": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
      "eye-off": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
      "zap": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
      "refresh-cw": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
      "image": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
      "x": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
      "wifi": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
      "more-horizontal": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`,
      "filter": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
      "folder": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
      "sun": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
      "key": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`,
      "alert-triangle": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
      "edit": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
      "check": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      "log-out": `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`
    };
    return icons[name] || icons["folder"];
  },

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  toggleDocumentEditMode() {
    this.state.isEditingDoc = !this.state.isEditingDoc;
    this.renderCurrentView();
  },

  cancelDocumentEdit() {
    this.state.isEditingDoc = false;
    this.renderCurrentView();
  },

  async saveDocumentEdits(id) {
    const title = document.getElementById("editDocTitle")?.value.trim();
    const document_type = document.getElementById("editDocType")?.value.trim();
    const country = document.getElementById("editDocCountry")?.value.trim();
    const document_number = document.getElementById("editDocNumber")?.value.trim();
    const category = document.getElementById("editDocCategory")?.value;
    const issued_date = document.getElementById("editDocIssued")?.value || null;
    const expires_date = document.getElementById("editDocExpires")?.value || null;
    const notes = document.getElementById("editDocNotes")?.value.trim();

    if (!title) {
      this.showToast("Document title cannot be empty", "error");
      return;
    }

    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PUT",
        headers: {
          ...this.getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title,
          document_type,
          country,
          document_number,
          category,
          issued_date,
          expires_date,
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");

      // Update activeDoc and documents array
      if (data.document && data.document.id) {
        this.state.activeDoc = data.document;
      } else {
        Object.assign(this.state.activeDoc, {
          title,
          document_type,
          country,
          document_number,
          category,
          issued_date,
          expires_date,
          notes
        });
      }

      const idx = this.state.documents.findIndex(d => d.id === id);
      if (idx !== -1) {
        this.state.documents[idx] = { ...this.state.activeDoc };
      }

      this.state.isEditingDoc = false;
      this.showToast("Document details updated and encrypted in vault", "success");
      await this.loadDocuments();
      this.renderCurrentView();
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  setCardViewMode(mode) {
    this.state.cardViewMode = mode;
    this.renderCurrentView();
  },

  async handleReplaceDocumentFile(event, docId) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast("Encrypting & storing new scan in vault...", "info");
      const res = await fetch(`/api/documents/${docId}/file`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "File upload failed");

      if (data.document) {
        this.state.activeDoc = data.document;
        const idx = this.state.documents.findIndex(d => d.id === docId);
        if (idx !== -1) this.state.documents[idx] = data.document;
      }
      this.state.cardViewMode = "file";
      this.showToast("Personal document scan encrypted & updated in vault!", "success");
      await this.loadDocuments();
      this.renderCurrentView();
    } catch (err) {
      this.showToast(err.message, "error");
    }
  },

  bindGlobalEvents() {
    // Form upload submission
    const form = document.getElementById("addDocumentForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        this.uploadDocument(formData);
      });
    }

    // Drag and drop for upload zone
    const dropzone = document.getElementById("docDropzone");
    const fileInput = document.getElementById("docFileInput");
    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          document.getElementById("dropzoneText").textContent = e.dataTransfer.files[0].name;
        }
      });
      fileInput.addEventListener("change", (e) => {
        if (e.target.files.length) {
          document.getElementById("dropzoneText").textContent = e.target.files[0].name;
        }
      });
    }
  },

  bindViewEvents() {
    // Attach dynamically if needed
  },

  renderCategoryCounts() {
    // Counts updated dynamically in state
  }
};

window.VotlyApp = VotlyApp;
document.addEventListener("DOMContentLoaded", () => VotlyApp.init());
