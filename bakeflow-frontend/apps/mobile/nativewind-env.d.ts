/// <reference types="nativewind/types" />

// TypeScript 6 (TS2882) rejects a side-effect import with no declaration.
// global.css is consumed by NativeWind's Metro transformer, not by TS.
declare module '*.css';
