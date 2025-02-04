"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const MAX_PARTICLES = 1000;
const MAGNETIC_TILT = Math.PI / 10; // ~18 degrees tilt
const JUPITER_ROTATION_SPEED = 0.002;
const MAGNETIC_FIELD_STRENGTH = 0.2; // Increased field strength
const IO_ORBIT_RADIUS = 12;
const TORUS_RADIUS = 10; // Slightly inside Io's orbit
const NUM_FIELD_LINES = 16;
const FIELD_LINE_POINTS = 50;
const FIELD_LINE_LENGTH = 20;
const MAX_DISTANCE = 30; // Maximum allowed distance from Jupiter
const MIN_DISTANCE = 3; // Minimum allowed distance from Jupiter

// Volcanic eruption parameters
const ERUPTION_DURATION = 100; // How long an eruption lasts
const ERUPTION_COOLDOWN = 200; // Minimum time between eruptions
const ERUPTION_CHANCE = 0.005; // Chance to start a new eruption when not in cooldown
const PARTICLES_PER_FRAME_DURING_ERUPTION = 5; // How many particles to emit during active eruption
const BASE_EMISSION_RATE = 0.1; // Background emission rate when not erupting

// Moon orbital parameters (scaled for visualization)
const MOONS = {
  IO: {
    RADIUS: 0.5,
    ORBIT_RADIUS: 12,
    ORBIT_SPEED: 0.005,
    COLOR: 0xffff00, // Bright yellow
    EMISSIVE: 0x441100,
  },
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particleSystemRef = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    colors: Float32Array;
    geometry: THREE.BufferGeometry;
    activeParticles: number;
  }>({
    positions: new Float32Array(MAX_PARTICLES * 3),
    velocities: new Float32Array(MAX_PARTICLES * 3),
    colors: new Float32Array(MAX_PARTICLES * 3),
    geometry: new THREE.BufferGeometry(),
    activeParticles: 0,
  });
  const eruption = useRef<{
    isActive: boolean;
    countdown: number;
    cooldown: number;
  }>({
    isActive: false,
    countdown: 0,
    cooldown: 0,
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Texture loader
    const textureLoader = new THREE.TextureLoader();

    // Jupiter with texture
    const jupiterGeometry = new THREE.SphereGeometry(5, 64, 64);
    const jupiterTexture = textureLoader.load("/jupiter_texture.jpg");
    jupiterTexture.wrapS = jupiterTexture.wrapT = THREE.RepeatWrapping;
    const jupiterMaterial = new THREE.MeshPhongMaterial({
      map: jupiterTexture,
      bumpScale: 0.05,
      specular: new THREE.Color(0x222222),
      shininess: 5,
    });
    const jupiter = new THREE.Mesh(jupiterGeometry, jupiterMaterial);
    scene.add(jupiter);

    // Magnetic field axis visualization
    const magneticAxisGeometry = new THREE.CylinderGeometry(0.1, 0.1, 15, 8);
    const magneticAxisMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
    });
    const magneticAxis = new THREE.Mesh(
      magneticAxisGeometry,
      magneticAxisMaterial
    );
    magneticAxis.rotation.x = MAGNETIC_TILT;
    jupiter.add(magneticAxis);

    // Create moons and their orbits
    const createMoon = (params: typeof MOONS.IO, name: string) => {
      const moonGeometry = new THREE.SphereGeometry(params.RADIUS, 32, 32);
      const moonMaterial = new THREE.MeshPhongMaterial({
        color: params.COLOR,
        emissive: params.EMISSIVE,
        shininess: 20,
        specular: new THREE.Color(0x333333),
      });
      const moon = new THREE.Mesh(moonGeometry, moonMaterial);
      scene.add(moon);

      // Enhanced orbit line
      const orbitGeometry = new THREE.RingGeometry(
        params.ORBIT_RADIUS,
        params.ORBIT_RADIUS + 0.2, // Slightly thicker orbit line
        128
      );
      const orbitMaterial = new THREE.MeshBasicMaterial({
        color: params.COLOR,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.3, // Slightly more visible
      });
      const orbitLine = new THREE.Mesh(orbitGeometry, orbitMaterial);
      orbitLine.rotation.x = Math.PI / 2;
      scene.add(orbitLine);

      return { moon, orbitLine, name };
    };

    // Create all moons
    const io = createMoon(MOONS.IO, "Io");

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1.0);
    scene.add(ambientLight);

    const mainLight = new THREE.PointLight(0xffffff, 2.0);
    mainLight.position.set(50, 20, 50);
    scene.add(mainLight);

    // Camera position
    camera.position.z = 40;
    camera.position.y = 20;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 20;
    controls.maxDistance = 80;

    // Calculate magnetic field vector at a point
    const getMagneticFieldVector = (
      position: THREE.Vector3,
      jupiterRotation: number
    ): THREE.Vector3 => {
      // Transform position to magnetic field coordinates
      const magneticPos = position.clone();
      magneticPos.applyAxisAngle(new THREE.Vector3(1, 0, 0), MAGNETIC_TILT);
      magneticPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), jupiterRotation);

      // Calculate dipole field
      const r = magneticPos.length();
      const r2 = r * r;
      const r5 = r2 * r2 * r;

      // B = (3(m·r)r - mr²)/r⁵
      const m = new THREE.Vector3(0, 1, 0); // Magnetic moment along y-axis
      const mDotR = m.dot(magneticPos);

      const field = new THREE.Vector3();
      field.copy(magneticPos).multiplyScalar(3 * mDotR);
      field.sub(m.multiplyScalar(r2));
      field.divideScalar(r5);

      // Transform back to world coordinates
      field.applyAxisAngle(new THREE.Vector3(0, 1, 0), -jupiterRotation);
      field.applyAxisAngle(new THREE.Vector3(1, 0, 0), -MAGNETIC_TILT);

      return field.multiplyScalar(MAGNETIC_FIELD_STRENGTH);
    };

    // Particle System Setup
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);

    // Initialize all particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const i3 = i * 3;
      positions[i3] = 0;
      positions[i3 + 1] = 0;
      positions[i3 + 2] = 0;

      colors[i3] = 1.0; // Red
      colors[i3 + 1] = 0.5; // Green
      colors[i3 + 2] = 0.2; // Blue
    }

    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    particleGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3)
    );

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.8,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Store particle system reference
    particleSystemRef.current = {
      positions,
      velocities,
      colors,
      geometry: particleGeometry,
      activeParticles: 0,
    };

    // Create magnetic field lines
    const fieldLines: THREE.Line[] = [];
    const createFieldLines = () => {
      // Clear existing field lines
      fieldLines.forEach((line) => scene.remove(line));
      fieldLines.length = 0;

      // Create new field lines
      for (let i = 0; i < NUM_FIELD_LINES; i++) {
        const angle = (i / NUM_FIELD_LINES) * Math.PI * 2;
        const startRadius = 1.0; // Start from near Jupiter's surface

        // Create points for the field line
        const points: THREE.Vector3[] = [];
        for (let j = 0; j < FIELD_LINE_POINTS; j++) {
          const t = j / (FIELD_LINE_POINTS - 1);
          const radius = startRadius + t * FIELD_LINE_LENGTH;

          // Parametric equations for magnetic field line
          const theta = angle;
          const phi =
            Math.PI / 2 - (Math.PI - MAGNETIC_TILT) * Math.cos(t * Math.PI);

          const x = radius * Math.sin(phi) * Math.cos(theta);
          const y = radius * Math.cos(phi);
          const z = radius * Math.sin(phi) * Math.sin(theta);

          points.push(new THREE.Vector3(x, y, z));
        }

        // Create the line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0x4444ff,
          transparent: true,
          opacity: 0.3,
        });
        const line = new THREE.Line(geometry, material);

        // Create the mirrored line (opposite pole)
        const mirroredPoints = points.map(
          (p) => new THREE.Vector3(p.x, -p.y, p.z)
        );
        const mirroredGeometry = new THREE.BufferGeometry().setFromPoints(
          mirroredPoints
        );
        const mirroredLine = new THREE.Line(mirroredGeometry, material);

        fieldLines.push(line, mirroredLine);
        scene.add(line, mirroredLine);
      }
    };

    createFieldLines();

    // Animation
    let angle = 0;
    const animate = () => {
      requestAnimationFrame(animate);

      // Rotate Jupiter and magnetic field
      jupiter.rotation.y += JUPITER_ROTATION_SPEED;

      // Update field lines
      fieldLines.forEach((line) => {
        line.rotation.y = jupiter.rotation.y;
      });

      // Update Io position
      io.moon.position.x =
        MOONS.IO.ORBIT_RADIUS * Math.cos(angle * MOONS.IO.ORBIT_SPEED);
      io.moon.position.z =
        MOONS.IO.ORBIT_RADIUS * Math.sin(angle * MOONS.IO.ORBIT_SPEED);

      angle += 1;

      // Update particle system to use new io.moon reference
      if (particleSystemRef.current) {
        const { positions, velocities, colors, geometry, activeParticles } =
          particleSystemRef.current;

        // Emit new particles from Io
        // Update eruption state
        if (eruption.current.isActive) {
          // During active eruption
          eruption.current.countdown--;
          if (eruption.current.countdown <= 0) {
            // End eruption and start cooldown
            eruption.current.isActive = false;
            eruption.current.cooldown = ERUPTION_COOLDOWN;
          }

          // Emit multiple particles per frame during eruption
          for (let e = 0; e < PARTICLES_PER_FRAME_DURING_ERUPTION; e++) {
            if (Math.random() < 0.8) {
              // 80% chance per particle during eruption
              let particleIndex;
              if (activeParticles < MAX_PARTICLES) {
                particleIndex = activeParticles;
                particleSystemRef.current.activeParticles++;
              } else {
                particleIndex = Math.floor(Math.random() * MAX_PARTICLES);
              }

              const i3 = particleIndex * 3;

              // More energetic emission during eruption
              const eruptionOffset = 1.2; // Larger spread during eruption
              positions[i3] =
                io.moon.position.x + (Math.random() - 0.5) * eruptionOffset;
              positions[i3 + 1] =
                io.moon.position.y + (Math.random() - 0.5) * eruptionOffset;
              positions[i3 + 2] =
                io.moon.position.z + (Math.random() - 0.5) * eruptionOffset;

              // Higher initial velocity during eruption
              const radialDir = new THREE.Vector3(
                positions[i3],
                positions[i3 + 1],
                positions[i3 + 2]
              );
              radialDir.normalize();

              const eruptionSpeed = 0.04 + Math.random() * 0.02; // Faster initial speed
              velocities[i3] = radialDir.x * eruptionSpeed;
              velocities[i3 + 1] = radialDir.y * eruptionSpeed;
              velocities[i3 + 2] = radialDir.z * eruptionSpeed;

              // Brighter initial color during eruption
              colors[i3] = 1.0; // Red
              colors[i3 + 1] = 0.7; // More green for brighter appearance
              colors[i3 + 2] = 0.3; // More blue for brighter appearance
            }
          }
        } else {
          // Not in active eruption
          if (eruption.current.cooldown > 0) {
            eruption.current.cooldown--;
          } else if (Math.random() < ERUPTION_CHANCE) {
            // Start new eruption
            eruption.current.isActive = true;
            eruption.current.countdown = ERUPTION_DURATION;
          } else {
            // Background emission
            if (Math.random() < BASE_EMISSION_RATE) {
              let particleIndex;
              if (activeParticles < MAX_PARTICLES) {
                particleIndex = activeParticles;
                particleSystemRef.current.activeParticles++;
              } else {
                particleIndex = Math.floor(Math.random() * MAX_PARTICLES);
              }

              const i3 = particleIndex * 3;

              // Normal emission
              positions[i3] = io.moon.position.x + (Math.random() - 0.5) * 0.8;
              positions[i3 + 1] =
                io.moon.position.y + (Math.random() - 0.5) * 0.8;
              positions[i3 + 2] =
                io.moon.position.z + (Math.random() - 0.5) * 0.8;

              const radialDir = new THREE.Vector3(
                positions[i3],
                positions[i3 + 1],
                positions[i3 + 2]
              );
              radialDir.normalize();

              const speed = 0.02 + Math.random() * 0.01;
              velocities[i3] = radialDir.x * speed;
              velocities[i3 + 1] = radialDir.y * speed;
              velocities[i3 + 2] = radialDir.z * speed;

              colors[i3] = 1.0; // Red
              colors[i3 + 1] = 0.5; // Green
              colors[i3 + 2] = 0.2; // Blue
            }
          }
        }

        // Update existing particles (update Io position references)
        const numParticlesToUpdate = Math.max(MAX_PARTICLES, activeParticles);
        for (let i = 0; i < numParticlesToUpdate; i++) {
          const i3 = i * 3;

          // Skip invalid particles
          if (
            isNaN(positions[i3]) ||
            isNaN(positions[i3 + 1]) ||
            isNaN(positions[i3 + 2])
          ) {
            // Reset invalid particle back to Io
            positions[i3] = io.moon.position.x;
            positions[i3 + 1] = io.moon.position.y;
            positions[i3 + 2] = io.moon.position.z;
            velocities[i3] = 0;
            velocities[i3 + 1] = 0;
            velocities[i3 + 2] = 0;
            continue;
          }

          const position = new THREE.Vector3(
            positions[i3],
            positions[i3 + 1],
            positions[i3 + 2]
          );

          // Check if particle is too far or too close
          const distance = position.length();
          if (distance > MAX_DISTANCE || distance < MIN_DISTANCE) {
            // Reset particle back to Io
            positions[i3] = io.moon.position.x + (Math.random() - 0.5) * 0.8;
            positions[i3 + 1] =
              io.moon.position.y + (Math.random() - 0.5) * 0.8;
            positions[i3 + 2] =
              io.moon.position.z + (Math.random() - 0.5) * 0.8;
            velocities[i3] = 0;
            velocities[i3 + 1] = 0;
            velocities[i3 + 2] = 0;
            continue;
          }

          const velocity = new THREE.Vector3(
            velocities[i3],
            velocities[i3 + 1],
            velocities[i3 + 2]
          );

          // Get magnetic field at particle position
          const B = getMagneticFieldVector(position, jupiter.rotation.y);

          // Calculate magnetic force (F = qv × B)
          const force = velocity.clone().cross(B);

          // Update velocity with magnetic force (with safety check)
          if (!isNaN(force.length())) {
            velocity.add(force);
          }

          // Apply corotation with Jupiter's magnetic field
          const corotationSpeed =
            JUPITER_ROTATION_SPEED * (1.0 - Math.exp(-position.length() / 15));
          const corotation = new THREE.Vector3(-position.z, 0, position.x)
            .normalize()
            .multiplyScalar(corotationSpeed);

          if (!isNaN(corotation.length())) {
            velocity.add(corotation);
          }

          // Add containment forces to keep particles in a torus
          const idealRadius = TORUS_RADIUS;

          // Radial containment
          const radialForce = new THREE.Vector3().copy(position).normalize();
          const radialStrength =
            distance > idealRadius
              ? -0.01 * (distance - idealRadius)
              : 0.01 * (idealRadius - distance);

          if (!isNaN(radialStrength)) {
            radialForce.multiplyScalar(radialStrength);
            velocity.add(radialForce);
          }

          // Vertical containment (stronger than before)
          velocity.y *= 0.95; // Dampen vertical motion

          // Add a small force towards the magnetic equator
          const heightForce = new THREE.Vector3(0, -position.y * 0.02, 0);
          velocity.add(heightForce);

          // Limit maximum velocity
          const maxSpeed = 0.2;
          const currentSpeed = velocity.length();
          if (currentSpeed > maxSpeed) {
            velocity.multiplyScalar(maxSpeed / currentSpeed);
          }

          // Safety check before updating position
          if (!isNaN(velocity.length())) {
            positions[i3] += velocity.x;
            positions[i3 + 1] += velocity.y;
            positions[i3 + 2] += velocity.z;

            velocities[i3] = velocity.x;
            velocities[i3 + 1] = velocity.y;
            velocities[i3 + 2] = velocity.z;

            // Update color based on ionization (distance from Io)
            const distanceFromIo = new THREE.Vector3(
              positions[i3] - io.moon.position.x,
              positions[i3 + 1] - io.moon.position.y,
              positions[i3 + 2] - io.moon.position.z
            ).length();

            const ionization = Math.min(1.0, distanceFromIo / 5.0);
            colors[i3] = Math.max(0.2, 1.0 - ionization); // Red
            colors[i3 + 1] = 0.3 + ionization * 0.2; // Green
            colors[i3 + 2] = 0.2 + ionization * 0.8; // Blue
          } else {
            // Reset particle if velocity becomes invalid
            positions[i3] = io.moon.position.x;
            positions[i3 + 1] = io.moon.position.y;
            positions[i3 + 2] = io.moon.position.z;
            velocities[i3] = 0;
            velocities[i3 + 1] = 0;
            velocities[i3 + 2] = 0;
          }
        }

        // Update geometry attributes
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="relative w-full h-screen">
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* Moon Label */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-4 right-4 bg-black/70 text-white p-4 rounded-lg">
          <div className="flex items-center">
            <div
              className="w-3 h-3 rounded-full mr-2"
              style={{ backgroundColor: "#ffff00" }}
            ></div>
            <span>Io</span>
          </div>
        </div>
      </div>

      {/* Info Panel */}
      <div className="absolute top-4 left-4 bg-black/70 text-white p-4 rounded-lg max-w-xl space-y-4">
        <h1 className="text-xl font-bold">
          Jupiter&apos;s Magnetosphere & Io Plasma Torus
        </h1>

        <div className="text-sm space-y-2">
          <p className="font-semibold text-yellow-400">
            Io&apos;s Volcanic Activity:
          </p>
          <p>
            Io, Jupiter&apos;s innermost Galilean moon, is the most volcanically
            active body in the solar system. Its volcanoes eject sulfur dioxide
            and other materials into space (shown as red particles).
          </p>

          <p className="font-semibold text-blue-400 mt-2">Plasma Formation:</p>
          <p>
            The ejected material becomes ionized by solar radiation and electron
            collisions, transforming into a plasma (shown by particles turning
            blue). This plasma gets trapped by Jupiter&apos;s powerful magnetic
            field.
          </p>

          <p className="font-semibold text-green-400 mt-2">
            Magnetic Field Interaction:
          </p>
          <p>
            Jupiter&apos;s magnetic field (blue lines) is tilted by ~10° from
            its rotation axis (green line). The field captures the plasma and
            forces it to corotate with Jupiter, forming a torus-shaped ring of
            charged particles around Jupiter&apos;s equator.
          </p>

          <div className="mt-4 border-t border-gray-600 pt-4">
            <p className="font-semibold text-purple-400">
              Scientific References:
            </p>
            <ul className="list-disc list-inside space-y-2 text-xs mt-2">
              <li>
                <span className="text-gray-300">
                  Structure and Properties of the Io Plasma Torus
                </span>{" "}
                - Thomas, N., et al. (2004) Jupiter: The Planet, Satellites and
                Magnetosphere, 561-591
              </li>
              <li>
                <span className="text-gray-300">
                  Plasma Transport in the Io Plasma Torus
                </span>{" "}
                - Delamere, P. A., & Bagenal, F. (2003) Journal of Geophysical
                Research: Space Physics, 108(A7)
              </li>
              <li>
                <span className="text-gray-300">
                  Chemistry of the Io Plasma Torus
                </span>{" "}
                - Bagenal, F., et al. (2017) Astrophysical Journal, 837(1)
              </li>
              <li>
                <span className="text-gray-300">
                  Io&apos;s Plasma Environment During the Galileo Mission
                </span>{" "}
                - Frank, L. A., & Paterson, W. R. (2000) Journal of Geophysical
                Research, 105(A7)
              </li>
            </ul>
          </div>

          <p className="text-xs italic mt-4">
            Controls: Click and drag to rotate view • Scroll to zoom •
            Right-click and drag to pan
          </p>
        </div>
      </div>
    </div>
  );
}
