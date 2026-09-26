import { forwardRef, type ButtonHTMLAttributes } from "react"
import { motion } from "framer-motion"
import Tooltip from "./Tooltip"
import { cn } from "../utils/cn"

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  size?: number
  variant?: "ghost" | "solid"
}

const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, active, size = 40, variant = "ghost", className, children, ...rest },
  ref,
) {
  return (
    <Tooltip label={label}>
      <motion.button
        ref={ref}
        type="button"
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        style={{ width: size, height: size }}
        className={cn(
          "focus-ring relative grid place-items-center rounded-full transition-colors",
          variant === "solid" ? "bg-white text-black hover:bg-white/90" : "text-mid hover:text-hi hover:bg-white/8",
          active && variant === "ghost" && "text-hi",
          className,
        )}
        {...(rest as any)}
      >
        {children}
        {active && variant === "ghost" && <span className="absolute -bottom-1 h-1 w-1 rounded-full" style={{ background: "var(--accent)" }} />}
      </motion.button>
    </Tooltip>
  )
})

export default IconButton
