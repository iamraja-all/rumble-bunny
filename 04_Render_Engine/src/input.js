export class InputManager {
  constructor() {
    this.state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      drift: false
    };

    // Keyboard state
    this.keys = { w: false, a: false, s: false, d: false, space: false };
    
    // Touch state
    this.touch = { left: false, right: false, gas: false, brake: false, drift: false };

    this._bindKeyboard();
    this._bindTouch();
  }

  _bindKeyboard() {
    const updateKeys = (e, isDown) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') this.keys.w = isDown;
      if (key === 's' || key === 'arrowdown') this.keys.s = isDown;
      if (key === 'a' || key === 'arrowleft') this.keys.a = isDown;
      if (key === 'd' || key === 'arrowright') this.keys.d = isDown;
      if (key === ' ') this.keys.space = isDown;
    };

    window.addEventListener('keydown', (e) => updateKeys(e, true));
    window.addEventListener('keyup', (e) => updateKeys(e, false));
  }

  _bindTouch() {
    // Only bind if touch controls exist in DOM
    const setupButton = (id, stateKey) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      
      const setTrue = (e) => { e.preventDefault(); this.touch[stateKey] = true; };
      const setFalse = (e) => { e.preventDefault(); this.touch[stateKey] = false; };
      
      btn.addEventListener('touchstart', setTrue, { passive: false });
      btn.addEventListener('touchend', setFalse, { passive: false });
      btn.addEventListener('touchcancel', setFalse, { passive: false });
    };

    // We will ensure the touch overlay is visible if touch is used
    window.addEventListener('touchstart', () => {
      const overlay = document.getElementById('touch-controls');
      if (overlay && overlay.style.display !== 'flex') {
        overlay.style.display = 'flex';
      }
    }, { once: true });

    setupButton('touch-left', 'left');
    setupButton('touch-right', 'right');
    setupButton('touch-gas', 'gas');
    setupButton('touch-brake', 'brake');
    setupButton('touch-drift', 'drift');
  }

  _pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gpState = { throttle: 0, brake: 0, steer: 0, drift: false, active: false };

    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        gpState.active = true;
        
        // Left stick X axis for steering (Axis 0)
        let steer = gp.axes[0] || 0;
        // Deadzone
        if (Math.abs(steer) < 0.1) steer = 0;
        gpState.steer = steer;

        // Triggers for gas/brake (Buttons 6 and 7, or Buttons 7 and 6 depending on mapping)
        // Standard mapping: R2 is button 7, L2 is button 6.
        const l2 = gp.buttons[6] ? gp.buttons[6].value : 0;
        const r2 = gp.buttons[7] ? gp.buttons[7].value : 0;
        gpState.throttle = r2;
        gpState.brake = l2;

        // Face button for drift (Button 0 usually A/Cross, Button 1 is B/Circle)
        // Let's allow either A or B or X for drift
        gpState.drift = (gp.buttons[0] && gp.buttons[0].pressed) || 
                        (gp.buttons[1] && gp.buttons[1].pressed) || 
                        (gp.buttons[2] && gp.buttons[2].pressed);
        
        // Sometimes D-pad is mapped as buttons (14 = left, 15 = right)
        if (gp.buttons[14] && gp.buttons[14].pressed) gpState.steer = -1;
        if (gp.buttons[15] && gp.buttons[15].pressed) gpState.steer = 1;

        break; // Only use the first active controller
      }
    }
    return gpState;
  }

  getState() {
    // 1. Poll Gamepad
    const gp = this._pollGamepad();

    // 2. Aggregate all sources (Gamepad > Touch > Keyboard)
    
    // Throttle
    if (gp.active && gp.throttle > 0) this.state.throttle = gp.throttle;
    else if (this.touch.gas) this.state.throttle = 1.0;
    else if (this.keys.w) this.state.throttle = 1.0;
    else this.state.throttle = 0;

    // Brake
    if (gp.active && gp.brake > 0) this.state.brake = gp.brake;
    else if (this.touch.brake) this.state.brake = 1.0;
    else if (this.keys.s) this.state.brake = 1.0;
    else this.state.brake = 0;

    // Steer
    if (gp.active && Math.abs(gp.steer) > 0) this.state.steer = gp.steer;
    else {
      let kSteer = 0;
      if (this.keys.a || this.touch.left) kSteer -= 1.0;
      if (this.keys.d || this.touch.right) kSteer += 1.0;
      this.state.steer = kSteer;
    }

    // Drift
    if (gp.active && gp.drift) this.state.drift = true;
    else if (this.touch.drift || this.keys.space) this.state.drift = true;
    else this.state.drift = false;

    return this.state;
  }
}
