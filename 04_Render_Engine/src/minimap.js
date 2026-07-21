/**
 * 2D Canvas Minimap Overlay
 * 
 * WHY:
 * Instead of adding a second WebGL camera and rendering the 3D scene twice (which
 * kills performance), we draw a simple 2D map over the UI. It directly reads the
 * physics ledger state and plots dots.
 */

export class Minimap {
  constructor() {
    this.width = 150;
    this.height = 300;
    
    // The track boundaries in physics units
    this.minX = -40;
    this.maxX = 40;
    this.minZ = -220; // past the last checkpoint
    this.maxZ = 20;   // behind the start line

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    // Style and position it in the bottom right
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

  /**
   * Map physics coordinates to canvas pixel coordinates
   */
  _mapCoord(x, z) {
    // X goes from left to right
    const px = ((x - this.minX) / (this.maxX - this.minX)) * this.width;
    // Z goes from bottom to top (negative Z is forward)
    const py = this.height - (((this.maxZ - z) / (this.maxZ - this.minZ)) * this.height);
    return { px, py };
  }

  draw(entities, localPid) {
    // Clear the canvas
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Draw a subtle center line for the track
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();
    const top = this._mapCoord(0, this.minZ);
    const bottom = this._mapCoord(0, this.maxZ);
    this.ctx.moveTo(top.px, top.py);
    this.ctx.lineTo(bottom.px, bottom.py);
    this.ctx.stroke();
    this.ctx.setLineDash([]); // reset

    // Draw checkpoints as horizontal lines
    const cps = [-40, -80, -130, -180];
    this.ctx.strokeStyle = 'rgba(0, 204, 255, 0.3)';
    this.ctx.lineWidth = 2;
    for (const z of cps) {
      const p1 = this._mapCoord(-20, z);
      const p2 = this._mapCoord(20, z);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.px, p1.py);
      this.ctx.lineTo(p2.px, p2.py);
      this.ctx.stroke();
    }

    // Draw Finish Line
    const fin1 = this._mapCoord(-20, -5);
    const fin2 = this._mapCoord(20, -5);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.beginPath();
    this.ctx.moveTo(fin1.px, fin1.py);
    this.ctx.lineTo(fin2.px, fin2.py);
    this.ctx.stroke();

    // Draw Vehicles
    for (const entity of entities) {
      if (entity.type === 'VEHICLE') {
        const { px, py } = this._mapCoord(entity.x, entity.z);
        const isLocal = entity.id === localPid;

        this.ctx.beginPath();
        this.ctx.arc(px, py, isLocal ? 6 : 4, 0, Math.PI * 2);
        
        if (isLocal) {
          this.ctx.fillStyle = '#00ccff'; // Cyan for local player
          this.ctx.shadowColor = '#00ccff';
          this.ctx.shadowBlur = 10;
        } else {
          this.ctx.fillStyle = '#ff3333'; // Red for opponents
          this.ctx.shadowBlur = 0;
        }
        
        this.ctx.fill();
        
        // If local player, draw a little direction indicator
        if (isLocal) {
          this.ctx.beginPath();
          this.ctx.moveTo(px, py);
          // Angle mapping (rotY=0 is facing -Z)
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
