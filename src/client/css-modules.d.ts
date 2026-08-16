/** Ambient declaration for CSS Modules consumed by the client bundle. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
