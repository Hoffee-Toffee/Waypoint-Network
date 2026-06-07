// vec3.js — lightweight 3D vector math used throughout the simulation
// All functions return new objects; inputs are never mutated.

'use strict'

const Vec3 = {
  /** Create a vector {x, y, z} */
  of(x, y, z) {
    return { x, y, z }
  },

  /** Add two vectors */
  add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
  },

  /** Subtract b from a */
  sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  },

  /** Scalar multiply */
  scale(a, s) {
    return { x: a.x * s, y: a.y * s, z: a.z * s }
  },

  /** Dot product */
  dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z
  },

  /** Cross product */
  cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    }
  },

  /** Squared magnitude */
  magSq(a) {
    return a.x * a.x + a.y * a.y + a.z * a.z
  },

  /** Magnitude */
  mag(a) {
    return Math.sqrt(Vec3.magSq(a))
  },

  /** Normalise (returns zero vector if input is zero) */
  norm(a) {
    const m = Vec3.mag(a)
    return m < 1e-30 ? { x: 0, y: 0, z: 0 } : Vec3.scale(a, 1 / m)
  },

  /** Distance between two points */
  dist(a, b) {
    return Vec3.mag(Vec3.sub(a, b))
  },

  /**
   * Perpendicular distance from `point` to the infinite line passing through
   * `lineA` and `lineB`. Returns 0 if lineA === lineB.
   */
  pointToLineDist(point, lineA, lineB) {
    const AB = Vec3.sub(lineB, lineA)
    const AP = Vec3.sub(point, lineA)
    const abMag = Vec3.mag(AB)
    if (abMag < 1e-30) return Vec3.mag(AP)
    const cross = Vec3.cross(AB, AP)
    return Vec3.mag(cross) / abMag
  },

  /**
   * Angle (degrees) between two vectors.
   */
  angleDeg(a, b) {
    const cosA = Vec3.dot(Vec3.norm(a), Vec3.norm(b))
    return Math.acos(Math.max(-1, Math.min(1, cosA))) * (180 / Math.PI)
  },

  /**
   * Rotate vector v around axis (unit vector) by angleDeg using Rodrigues' formula.
   */
  rotateAround(v, axis, angleDeg) {
    const theta = angleDeg * (Math.PI / 180)
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    const k = Vec3.norm(axis)
    // v·cosT + (k×v)·sinT + k·(k·v)·(1-cosT)
    return Vec3.add(
      Vec3.add(Vec3.scale(v, cosT), Vec3.scale(Vec3.cross(k, v), sinT)),
      Vec3.scale(k, Vec3.dot(k, v) * (1 - cosT)),
    )
  },

  /**
   * Project a 3D point onto the galactic plane (Z=0) for 2D rendering.
   * Returns {x, y}.
   */
  project(v) {
    return { x: v.x, y: v.y }
  },
}
