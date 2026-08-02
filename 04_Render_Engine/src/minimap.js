import { CIRCUIT_DEF } from '../../03_Stable_Build/circuit-track.js';

export class Minimap {
  constructor() {
    this.width = 200;
    this.height = 200;
    
    // Coastal Stunt Circuit bounding box approx
    this.minX = -80;
    this.maxX = 80;
    this.minZ = -120;
    this.maxZ = 80;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    this.canvas.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(0, 204, 255, 0.3);
      border-radius: 8px;
      backdrop-filter: blur(4px);
      z-index: 100;
      pointer-events: none;
    `;

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  _mapCoord(x, z) {
    const px = ((x - this.minX) / (this.maxX - this.minX)) * this.width;
    const py = this.height - (((this.maxZ - z) / (this.maxZ - this.minZ)) * this.height);
    return { px, py };
  }

  draw(entities, localPid) {
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Draw Main Road
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 6;
    this.ctx.beginPath();
    let first = true;
    for (const p of CIRCUIT_DEF.road.mainPoints) {
      const { px, py } = this._mapCoord(p.x, p.z);
      if (first) { this.ctx.moveTo(px, py); first = false; }
      else this.ctx.lineTo(px, py);
    }
    // Connect back to start
    const start = this._mapCoord(CIRCUIT_DEF.road.mainPoints[0].x, CIRCUIT_DEF.road.mainPoints[0].z);
    this.ctx.lineTo(start.px, start.py);
    this.ctx.stroke();

    // Draw Shortcut
    this.ctx.strokeStyle = 'rgba(255, 165, 0, 0.2)';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    first = true;
    for (const p of CIRCUIT_DEF.road.shortcutPoints) {
      const { px, py } = this._mapCoord(p.x, p.z);
      if (first) { this.ctx.moveTo(px, py); first = false; }
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();

    // Draw gates
    for (const gate of CIRCUIT_DEF.gates) {
      const { px, py } = this._mapCoord(gate.center.x, gate.center.z);
      this.ctx.fillStyle = gate.id === 'G0' ? 'white' : 'rgba(0, 204, 255, 0.5)';
      this.ctx.fillRect(px - 2, py - 2, 4, 4);
    }

    // Draw Vehicles
    for (const entity of entities) {
      if (entity.type === 'VEHICLE') {
        const { px, py } = this._mapCoord(entity.x, entity.z);
        const isLocal = entity.id === localPid;
        const isOnShortcut = entity.modifiers && entity.modifiers.route === 'SHORTCUT';

        this.ctx.beginPath();
        this.ctx.arc(px, py, isLocal ? 6 : 4, 0, Math.PI * 2);
        
        if (isLocal) {
          this.ctx.fillStyle = '#00ccff'; 
          this.ctx.shadowColor = '#00ccff';
          this.ctx.shadowBlur = 10;
        } else {
          // Color code based on route
          this.ctx.fillStyle = isOnShortcut ? '#ffaa00' : '#ff3333';
          this.ctx.shadowBlur = 0;
        }
        
        this.ctx.fill();
        
        if (isLocal) {
          this.ctx.beginPath();
          this.ctx.moveTo(px, py);
          const dx = Math.sin(entity.rotY) * 10;
          const dy = -Math.cos(entity.rotY) * 10;
          this.ctx.lineTo(px + dx, py + dy);
          this.ctx.strokeStyle = '#ffffff';
          this.ctx.lineWidth = 2;
          this.ctx.stroke();
        }
      }
    }
  }
}
