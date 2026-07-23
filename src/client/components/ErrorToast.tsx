import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";

interface ErrorToastProps {
  message: string | null;
}

export function ErrorToast({ message }: ErrorToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 max-w-[90vw]"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
