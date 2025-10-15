import {
  createAccount,
  getCurrentUser,
  login,
  logout,
  onAuthChange,
} from "./auth.js";

const accountButton = document.getElementById("accountButton");
const accountButtonLabel = document.getElementById("accountButtonLabel");
const accountStatus = document.getElementById("accountStatus");
const navLogoutButton = document.getElementById("accountLogoutButton");

const loginForm = document.getElementById("loginForm");
const loginNameInput = document.getElementById("loginName");
const loginPasswordInput = document.getElementById("loginPassword");
const loginRememberInput = document.getElementById("loginRemember");
const loginErrorEl = document.getElementById("loginError");
const loginHintEl = document.getElementById("loginHint");
const loginSubmit = document.getElementById("loginSubmit");

const signupSection = document.getElementById("signupSection");
const signupToggleButton = document.getElementById("signupToggle");
const signupForm = document.getElementById("signupForm");
const signupNameInput = document.getElementById("signupName");
const signupPasswordInput = document.getElementById("signupPassword");
const signupPasswordConfirmInput = document.getElementById("signupPasswordConfirm");
const signupErrorEl = document.getElementById("signupError");
const signupSubmit = document.getElementById("signupSubmit");

const profileEl = document.getElementById("accountProfile");
const nameDisplay = document.getElementById("accountNameDisplay");
const profileLogoutButton = document.getElementById("logoutButton");

let signupExpanded = false;
let sessionUser = getCurrentUser();

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

function setSignupVisibility(visible) {
  const shouldShow = !!visible && !sessionUser;
  signupExpanded = shouldShow;
  if (signupForm) {
    signupForm.hidden = !shouldShow;
  }
  if (signupToggleButton) {
    signupToggleButton.setAttribute("aria-expanded", String(shouldShow));
  }
  if (!shouldShow) {
    showError(signupErrorEl, "");
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
  const isLoggedIn = !!user;
  if (accountButtonLabel) {
    accountButtonLabel.textContent = isLoggedIn ? user.name : "Log in";
  }
  if (accountButton) {
    accountButton.setAttribute(
      "aria-label",
      isLoggedIn ? `Account for ${user.name}` : "Open account page",
    );
  }
  if (accountStatus) {
    accountStatus.hidden = !isLoggedIn;
    accountStatus.textContent = isLoggedIn ? `Watching as ${user.name}` : "";
  }
  if (navLogoutButton) {
    navLogoutButton.hidden = !isLoggedIn;
    navLogoutButton.disabled = !isLoggedIn;
  }
  if (loginNameInput) {
    loginNameInput.value = isLoggedIn ? user.name : "";
  }
  if (signupNameInput && !isLoggedIn && !signupExpanded) {
    signupNameInput.value = "";
  }
  if (profileEl) {
    profileEl.hidden = !isLoggedIn;
  }
  if (profileLogoutButton) {
    profileLogoutButton.hidden = !isLoggedIn;
    profileLogoutButton.disabled = !isLoggedIn;
  }
  if (loginForm) {
    loginForm.hidden = isLoggedIn;
  }
  if (loginHintEl) {
    loginHintEl.hidden = isLoggedIn;
  }
  if (signupSection) {
    signupSection.hidden = isLoggedIn;
  }
  if (signupToggleButton) {
    signupToggleButton.hidden = isLoggedIn;
    signupToggleButton.setAttribute("aria-expanded", String(!isLoggedIn && signupExpanded));
  }
  if (signupForm) {
    signupForm.hidden = isLoggedIn || !signupExpanded;
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

signupToggleButton?.addEventListener("click", () => {
  setSignupVisibility(!signupExpanded);
  if (signupExpanded && signupNameInput && !signupForm?.hidden) {
    signupNameInput.focus();
    signupNameInput.select?.();
  } else if (!signupExpanded && loginNameInput && !loginForm?.hidden) {
    loginNameInput.focus();
    loginNameInput.select?.();
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
  setSignupVisibility(false);
});

navLogoutButton?.addEventListener("click", () => {
  logout();
});

profileLogoutButton?.addEventListener("click", () => {
  logout();
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
  setSignupVisibility(false);
});

onAuthChange((user) => {
  sessionUser = user;
  if (!sessionUser) {
    setSignupVisibility(false);
  }
  updateForUser(user);
});

setSignupVisibility(false);
updateForUser(sessionUser);

