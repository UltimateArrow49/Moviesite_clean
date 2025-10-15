import {
  createAccount,
  getCurrentUser,
  login,
  logout,
  onAuthChange,
} from "./auth.js";

const controls = document.getElementById("accountControls");
if (!controls) {
  return;
}

const trigger = document.getElementById("accountButton");
const triggerLabel = document.getElementById("accountButtonLabel");
const menu = document.getElementById("accountMenu");
const loginForm = document.getElementById("loginForm");
const loginNameInput = document.getElementById("loginName");
const loginPasswordInput = document.getElementById("loginPassword");
const loginRememberInput = document.getElementById("loginRemember");
const loginErrorEl = document.getElementById("loginError");
const signupForm = document.getElementById("signupForm");
const signupNameInput = document.getElementById("signupName");
const signupPasswordInput = document.getElementById("signupPassword");
const signupPasswordConfirmInput = document.getElementById("signupPasswordConfirm");
const signupErrorEl = document.getElementById("signupError");
const showSignupButton = document.getElementById("showSignup");
const showLoginButton = document.getElementById("showLogin");
const loginHintEl = document.getElementById("loginHint");
const profileEl = document.getElementById("accountProfile");
const nameDisplay = document.getElementById("accountNameDisplay");
const logoutButton = document.getElementById("logoutButton");
const loginSubmit = document.getElementById("loginSubmit");
const signupSubmit = document.getElementById("signupSubmit");

let menuOpen = false;
let authMode = "login";
let sessionUser = getCurrentUser();

function setMenuVisibility(visible) {
  if (!menu || !trigger) return;
  const wasOpen = menuOpen;
  menu.hidden = !visible;
  menuOpen = visible;
  trigger.setAttribute("aria-expanded", String(visible));
  if (visible && !wasOpen && !sessionUser && authMode !== "login") {
    toggleForms("login");
  }
  if (visible) {
    if (!sessionUser) {
      if (authMode === "signup" && signupNameInput && signupForm && !signupForm.hidden) {
        signupNameInput.focus();
        signupNameInput.select?.();
      } else if (loginForm && !loginForm.hidden && loginNameInput) {
        loginNameInput.focus();
        loginNameInput.select?.();
      }
    } else if (profileEl && !profileEl.hidden) {
      profileEl.focus?.();
    }
  }
}

function closeMenu() {
  setMenuVisibility(false);
}

function showError(element, message) {
  if (!element) return;
  if (!message) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.hidden = false;
  element.textContent = message;
}

function toggleForms(mode) {
  if (sessionUser) {
    if (loginForm) loginForm.hidden = true;
    if (signupForm) signupForm.hidden = true;
    if (loginHintEl) {
      loginHintEl.hidden = true;
    }
    return;
  }
  authMode = mode === "signup" ? "signup" : "login";
  if (loginForm) {
    loginForm.hidden = authMode !== "login";
  }
  if (signupForm) {
    signupForm.hidden = authMode !== "signup";
  }
  if (loginHintEl) {
    loginHintEl.hidden = authMode !== "login";
  }
}

function setFormBusy(form, busy) {
  if (!form) return;
  const elements = form.querySelectorAll("input, button");
  elements.forEach((element) => {
    element.disabled = busy;
  });
}

function updateForUser(user) {
  if (!trigger || !triggerLabel) return;
  const isLoggedIn = !!user;
  triggerLabel.textContent = isLoggedIn ? user.name : "Account";
  trigger.setAttribute(
    "aria-label",
    isLoggedIn ? `Account menu for ${user.name}` : "Open account menu",
  );
  if (loginNameInput) {
    loginNameInput.value = isLoggedIn ? user.name : "";
  }
  if (signupNameInput && authMode === "signup" && !isLoggedIn) {
    signupNameInput.value = "";
  }
  if (profileEl) {
    profileEl.hidden = !isLoggedIn;
  }
  if (loginForm) {
    loginForm.hidden = isLoggedIn || authMode !== "login";
  }
  if (signupForm) {
    signupForm.hidden = isLoggedIn || authMode !== "signup";
  }
  if (loginHintEl) {
    loginHintEl.hidden = isLoggedIn || authMode !== "login";
  }
  if (loginRememberInput) {
    loginRememberInput.checked = false;
  }
  if (nameDisplay) {
    nameDisplay.textContent = isLoggedIn ? user.name : "";
  }
  showError(loginErrorEl, "");
  showError(signupErrorEl, "");
}

trigger?.addEventListener("click", () => {
  setMenuVisibility(!menuOpen);
});

showSignupButton?.addEventListener("click", () => {
  toggleForms("signup");
  if (menuOpen) {
    setMenuVisibility(true);
  }
});

showLoginButton?.addEventListener("click", () => {
  toggleForms("login");
  if (menuOpen) {
    setMenuVisibility(true);
  }
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm) return;
  const nameValue = loginNameInput ? loginNameInput.value : "";
  const passwordValue = loginPasswordInput ? loginPasswordInput.value : "";
  const rememberValue = loginRememberInput ? loginRememberInput.checked : false;
  setFormBusy(loginForm, true);
  showError(signupErrorEl, "");
  const result = await login(nameValue, passwordValue, rememberValue);
  setFormBusy(loginForm, false);
  if (!result.success) {
    showError(loginErrorEl, result.error);
    if (loginSubmit) {
      loginSubmit.focus();
    }
    return;
  }
  showError(loginErrorEl, "");
  if (loginPasswordInput) {
    loginPasswordInput.value = "";
  }
  if (loginRememberInput) {
    loginRememberInput.checked = false;
  }
  sessionUser = result.user || null;
  setMenuVisibility(false);
});

logoutButton?.addEventListener("click", () => {
  logout();
  closeMenu();
});

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!signupForm) return;
  const nameValue = signupNameInput ? signupNameInput.value : "";
  const passwordValue = signupPasswordInput ? signupPasswordInput.value : "";
  const confirmValue = signupPasswordConfirmInput ? signupPasswordConfirmInput.value : "";
  if (passwordValue !== confirmValue) {
    showError(signupErrorEl, "Passwords do not match.");
    return;
  }
  setFormBusy(signupForm, true);
  showError(loginErrorEl, "");
  const result = await createAccount(nameValue, passwordValue);
  setFormBusy(signupForm, false);
  if (!result.success) {
    showError(signupErrorEl, result.error);
    if (signupSubmit) {
      signupSubmit.focus();
    }
    return;
  }
  showError(signupErrorEl, "");
  if (signupNameInput) {
    signupNameInput.value = "";
  }
  if (signupPasswordInput) {
    signupPasswordInput.value = "";
  }
  if (signupPasswordConfirmInput) {
    signupPasswordConfirmInput.value = "";
  }
  sessionUser = result.user || null;
  toggleForms("login");
  setMenuVisibility(false);
});

window.addEventListener("click", (event) => {
  if (!menuOpen) return;
  if (!controls.contains(event.target)) {
    closeMenu();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuOpen) {
    closeMenu();
    trigger?.focus();
  }
});

onAuthChange((user) => {
  sessionUser = user;
  if (!sessionUser) {
    toggleForms("login");
  }
  updateForUser(user);
});

toggleForms(authMode);
updateForUser(sessionUser);

