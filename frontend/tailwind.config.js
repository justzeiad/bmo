/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bmo: {
          bg: "#040706",
          panel: "#09110d",
          line: "#1a3a28",
          text: "#e8ffef",
          sub: "#8fd9a3",
          accent: "#3ae66d",
          accentSoft: "#a4ffbc",
          danger: "#ff6e78",
        },
      },
      boxShadow: {
        crt: "0 0 0 1px rgba(58, 230, 109, 0.2), 0 24px 40px rgba(0, 0, 0, 0.55)",
      },
    },
  },
  plugins: [],
};
