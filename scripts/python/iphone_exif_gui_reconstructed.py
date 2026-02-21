"""
iPhone EXIF Modifier
Exif editor by @ato_fx

This tool modifies EXIF metadata of photos to make them appear as if they were taken with an iPhone.
It includes GPS spoofing, random iPhone model selection, camera metadata generation, and subtle image modifications.
"""

import argparse
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk
from pathlib import Path
import subprocess
import threading
import traceback
import os
import sys
import shutil
import glob
import random
import math
from datetime import datetime, timedelta
from metadata_spoofer import (
    generate_random_filename,
    generate_random_location,
    generate_random_dates,
    generate_iphone_model,
    generate_camera_exif,
)

# Ensure console output uses UTF-8 (Windows defaults to cp1252)
if os.name == "nt":
    import io

    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace"
    )

# Optional imports
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

try:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
except ImportError:
    Image = None

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_DIR = BASE_DIR / "scripts" / "python" / "allpictures"
DEFAULT_OUTPUT_DIR = BASE_DIR / "scripts" / "python" / "DONE"


def resolve_exiftool_path():
    """Locate the exiftool executable across platforms."""
    overrides = [
        os.environ.get("EXIFTOOL_PATH"),
        shutil.which("exiftool"),
        shutil.which("exiftool.exe"),
        r"C:\Program Files\ExifTool\exiftool.exe",
        r"C:\Program Files (x86)\ExifTool\exiftool.exe",
    ]

    for candidate in overrides:
        if candidate and os.path.exists(candidate):
            return candidate

    return "exiftool"


EXIFTOOL_CMD = resolve_exiftool_path()


class RedirectText:
    """Class to redirect stdout to a Text widget"""

    def __init__(self, text_widget):
        self.text_widget = text_widget
        self.buffer = ""

    def write(self, string):
        self.text_widget.configure(state='normal')
        self.text_widget.insert('end', string)
        self.text_widget.see('end')
        self.text_widget.configure(state='disabled')

    def flush(self):
        pass


class IPhoneExifApp:
    """Main application class for iPhone EXIF Modifier"""

    def __init__(self, root):
        self.root = root
        self.root.title("iPhone EXIF Modifier")
        self.root.geometry("900x700")
        self.root.minsize(900, 700)

        # Variables
        self.input_path = tk.StringVar()
        self.output_path = tk.StringVar()
        self.nb_batches = tk.IntVar(value=1)
        self.photos_per_batch = tk.IntVar(value=0)
        self.modification_level = tk.IntVar(value=0)
        self.verbose_mode = tk.BooleanVar(value=True)
        self.processing = False

        # Style configuration
        self.style = ttk.Style()
        self.style.configure('TButton', padding=6, relief="flat", background="#4CAF50")
        self.style.configure('TLabel', padding=6)
        self.style.configure('TFrame', padding=6)

        # Create UI
        self.create_widgets()
        self.check_exiftool()

    def create_widgets(self):
        """Create the graphical user interface"""

        # Main title
        main_title = tk.Label(
            self.root,
            text="Exif editor by @ato_fx",
            font=("Helvetica", 16, "bold")
        )
        main_title.pack(pady=10)

        # Description
        description = tk.Label(
            self.root,
            text="Free tool to change EXIF and also edit pics values and GPS\nquestions ? =>check telegram"
        )
        description.pack(pady=5)

        # Main frame
        main_frame = tk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Left and right frames
        left_frame = tk.Frame(main_frame)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        right_frame = tk.Frame(main_frame)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # Setup frame
        config_frame = tk.LabelFrame(left_frame, text="Setup", padx=10, pady=10)
        config_frame.grid(row=0, column=0, sticky="ew", padx=5, pady=5)

        # Source selection
        tk.Label(config_frame, text="Folder/File source:").grid(row=0, column=0, sticky="w")
        tk.Entry(config_frame, textvariable=self.input_path, width=40).grid(row=0, column=1, padx=5)
        tk.Button(config_frame, text="Explore...", command=self.browse_input).grid(row=0, column=2)

        # Destination selection
        tk.Label(config_frame, text="Destination Folder:").grid(row=1, column=0, sticky="w")
        tk.Entry(config_frame, textvariable=self.output_path, width=40).grid(row=1, column=1, padx=5)
        tk.Button(config_frame, text="Explore...", command=self.browse_output).grid(row=1, column=2)

        # Photos frame
        photos_frame = tk.LabelFrame(left_frame, text="Photos", padx=10, pady=10)
        photos_frame.grid(row=1, column=0, sticky="ew", padx=5, pady=5)

        tk.Label(photos_frame, text="How many versions:").grid(row=0, column=0, sticky="w")
        tk.Spinbox(photos_frame, from_=1, to=100, textvariable=self.nb_batches, width=10).grid(row=0, column=1)

        tk.Label(photos_frame, text="Photos per batchs ?:\n(0 = all)").grid(row=1, column=0, sticky="w")
        tk.Spinbox(photos_frame, from_=0, to=1000, textvariable=self.photos_per_batch, width=10).grid(row=1, column=1)

        # Modification frame
        mod_frame = tk.LabelFrame(left_frame, text="Spoofing level:", padx=10, pady=10)
        mod_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=5, columnspan=2)

        for i in range(6):
            label = "None" if i == 0 else str(i)
            tk.Radiobutton(mod_frame, text=label, variable=self.modification_level, value=i).pack(anchor="w")

        tk.Checkbutton(left_frame, text="Show logs", variable=self.verbose_mode).grid(row=3, column=0, pady=5)

        left_frame.columnconfigure(0, weight=1)

        # Status frame
        status_frame = tk.LabelFrame(right_frame, text="Status", padx=10, pady=10)
        status_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.exiftool_status = tk.Label(
            status_frame,
            text=" ExifTool: checking processing...",
            foreground="orange",
            anchor="w"
        )
        self.exiftool_status.pack(fill=tk.X, pady=2)

        pillow_status_text = " Pillow: Install" if PILLOW_AVAILABLE else " Pillow: Not installed (modifications d'image limitées)"
        pillow_status_color = "green" if PILLOW_AVAILABLE else "orange"
        self.pillow_status = tk.Label(
            status_frame,
            text=pillow_status_text,
            foreground=pillow_status_color,
            anchor="w"
        )
        self.pillow_status.pack(fill=tk.X, pady=2)

        # Console frame
        console_frame = tk.LabelFrame(right_frame, text="Console", padx=5, pady=5)
        console_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.console = scrolledtext.ScrolledText(
            console_frame,
            wrap=tk.WORD,
            height=20,
            state='disabled'
        )
        self.console.pack(fill=tk.BOTH, expand=True)

        # Progress bar
        progress_frame = tk.Frame(right_frame)
        progress_frame.pack(fill=tk.X, padx=5, pady=5)

        self.progress = ttk.Progressbar(
            progress_frame,
            orient='horizontal',
            mode='determinate'
        )
        self.progress.pack(fill=tk.X)

        # Buttons frame
        buttons_frame = tk.Frame(right_frame)
        buttons_frame.pack(pady=10)

        self.start_button = tk.Button(
            buttons_frame,
            text="Start spoofing",
            command=self.start_processing
        )
        self.start_button.pack(side=tk.LEFT, padx=5)

        self.stop_button = tk.Button(
            buttons_frame,
            text="go back",
            command=self.cancel_processing,
            state='disabled'
        )
        self.stop_button.pack(side=tk.LEFT, padx=5)

        help_button = tk.Button(
            buttons_frame,
            text="Help",
            command=self.show_help
        )
        help_button.pack(side=tk.LEFT, padx=5)

        # Redirect stdout to console
        self.redirect = RedirectText(self.console)
        sys.stdout = self.redirect

    def browse_input(self):
        """Open folder/file selector for source"""
        folder = filedialog.askdirectory(title="Select source folder")
        if folder:
            self.input_path.set(folder)
            if not self.output_path.get():
                self.output_path.set(os.path.join(os.path.dirname(folder), "iPhone_EXIF_Output"))

    def browse_output(self):
        """Open folder selector to select output"""
        folder = filedialog.askdirectory(title="Select destination file")
        if folder:
            self.output_path.set(folder)

    def check_exiftool(self):
        """Check if ExifTool is available"""
        try:
            # Determine base directory
            if getattr(sys, 'frozen', False):
                BASE_DIR = sys._MEIPASS
            else:
                BASE_DIR = os.path.dirname(os.path.abspath(__file__))

            EXIFTOOL_PATH = os.path.join(BASE_DIR, 'resources', 'exiftool.exe')

            if os.path.exists(EXIFTOOL_PATH) and os.path.isfile(EXIFTOOL_PATH):
                result = subprocess.run(
                    [EXIFTOOL_PATH, '-ver'],
                    capture_output=True,
                    text=True
                )
                if result.returncode == 0:
                    version = result.stdout.strip()
                    self.exiftool_status.config(
                        text=f" ExifTool: found (version {version})",
                        foreground="green"
                    )
                    return

            # Check common Windows paths
            possible_paths = [
                "C:\\ExifTool\\exiftool.exe",
                "C:\\Program Files\\ExifTool\\exiftool.exe",
                "C:\\Windows\\exiftool.exe",
                "C:\\Windows\\System32\\exiftool.exe",
                ".\\exiftool.exe"
            ]

            for path in possible_paths:
                if os.path.exists(path):
                    result = subprocess.run([path, '-ver'], capture_output=True, text=True)
                    if result.returncode == 0:
                        version = result.stdout.strip()
                        self.exiftool_status.config(
                            text=f" ExifTool: found (version {version})",
                            foreground="green"
                        )
                        return

            # Try system path
            result = subprocess.run(['exiftool', '-ver'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip()
                self.exiftool_status.config(
                    text=f" ExifTool: found (version {version})",
                    foreground="green"
                )
                return

            raise FileNotFoundError("ExifTool not found")

        except (subprocess.CalledProcessError, FileNotFoundError):
            self.exiftool_status.config(
                text=" ExifTool: Not found! install it.",
                foreground="red"
            )
            messagebox.showerror(
                "ExifTool manquant",
                "ExifTool n'a pas été trouvé. Veuillez télécharger ExifTool depuis "
                "https://exiftool.org/ (Windows Executable), le renommer en 'exiftool.exe' "
                "et le placer dans le même dossier que ce programme."
            )

    def start_processing(self):
        """Launch pics spoofing"""
        if self.processing:
            return

        # Validation
        if not self.input_path.get():
            messagebox.showerror("Erreur", "Please select another source file/folder.")
            return

        if not os.path.exists(self.input_path.get()):
            messagebox.showerror("Erreur", f"The source '{self.input_path.get()}' doesn't exist.")
            return

        # Create output directory
        output_dir = self.output_path.get()
        if not output_dir:
            output_dir = os.path.join(os.getcwd(), "iPhone_EXIF_Output")
            self.output_path.set(output_dir)

        try:
            os.makedirs(output_dir, exist_ok=True)
        except Exception as e:
            messagebox.showerror("Erreur", f"Impossible to create output Folder: {e}")
            return

        # Reset interface
        self.processing = True
        self.start_button.config(state='disabled')
        self.stop_button.config(state='normal')
        self.console.config(state='normal')
        self.console.delete('1.0', tk.END)
        self.console.config(state='disabled')
        self.progress['value'] = 0

        # Start processing in thread
        self.process_thread = threading.Thread(target=self.run_processing, daemon=True)
        self.process_thread.start()

        # Check progress periodically
        self.root.after(100, self.check_progress)

    def run_processing(self):
        """Execute process in another thread"""
        try:
            output_dir = self.output_path.get()
            versions_count = self.nb_batches.get()
            verbose = self.verbose_mode.get()

            process_batch(
                self.input_path.get(),
                output_dir,
                versions_count,
                self.photos_per_batch.get(),
                self.modification_level.get(),
                verbose,
                self.update_progress
            )

            print("\n Traitement terminé avec succès!")
            self.root.after(0, lambda: messagebox.showinfo("FINISH", "All pics are spoofed!"))

        except Exception as e:
            print(f"\n ERREUR: {e}")
            traceback.print_exc()
            self.root.after(0, lambda: messagebox.showerror("Error", f"an error popped: {e}"))

        finally:
            self.root.after(0, self.reset_interface)

    def update_progress(self, current, total):
        """Met à jour la valeur de la barre de progression"""
        if total > 0:
            progress_percent = (current / total) * 100
            self.progress['value'] = progress_percent

    def check_progress(self):
        """Vérifie périodiquement si le traitement est terminé"""
        if self.processing and self.process_thread.is_alive():
            self.root.after(100, self.check_progress)
        else:
            self.reset_interface()

    def cancel_processing(self):
        """Annule le traitement en cours"""
        self.processing = False
        print("\n process canceled by the customer.")
        messagebox.showinfo("Annulé", "canceled.")

    def reset_interface(self):
        """Réinitialise l'interface après le traitement"""
        self.processing = False
        self.start_button.config(state='normal')
        self.stop_button.config(state='disabled')
        self.progress['value'] = 0

    def show_help(self):
        """Affiche l'aide"""
        help_text = """iPhone EXIF Modifier - Aide

Cet outil vous permet de modifier les métadonnées EXIF de vos photos pour qu'elles apparaissent comme si elles avaient été prises avec un iPhone.

Comment utiliser:
1. Sélectionnez un dossier ou un fichier photo source
2. Choisissez un dossier de destination (facultatif)
3. Définissez le nombre de versions à créer
4. Choisissez combien de photos traiter par version (0 = toutes)
5. Sélectionnez le niveau de modification d'image:
   - 0: Aucune modification
   - 1-5: De subtil à plus prononcé
6. Cliquez sur "Démarrer le traitement"

Informations importantes:
- ExifTool est nécessaire pour modifier les métadonnées
- Pillow est recommandé pour les modifications d'image avancées
- Les photos originales ne sont pas modifiées

Support:
Pour toute question ou problème, consultez la documentation d'ExifTool ou contactez le développeur.
"""

        help_window = tk.Toplevel(self.root)
        help_window.title("Aide - iPhone EXIF Modifier")
        help_window.geometry("600x500")

        help_text_widget = scrolledtext.ScrolledText(help_window, wrap=tk.WORD)
        help_text_widget.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        help_text_widget.insert('1.0', help_text)
        help_text_widget.config(state='disabled')

        tk.Button(help_window, text="Fermer", command=help_window.destroy).pack(pady=5)


# ============================================================================
# Utility Functions
# ============================================================================
def apply_subtle_modifications(img_path, level):
    """
    Applique des modifications subtiles à l'image pour éviter la détection par hachage perceptuel
    et analyse de pixels tout en gardant l'image visuellement similaire.

    Le niveau de modification (1-5) contrôle l'intensité des modifications:
    1: Très subtil, presque imperceptible
    5: Plus prononcé, mais visuellement acceptable

    Retourne True si les modifications ont été appliquées avec succès
    """
    if not PILLOW_AVAILABLE or level == 0:
        return False

    try:
        img = Image.open(img_path)

        # Convert to RGBA if needed
        if img.mode == 'RGBA':
            background = Image.new('RGBA', img.size, (255, 255, 255, 255))
            background.paste(img, mask=img)
            img = background.convert('RGB')
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        modifications = []

        # 1. Crop and resize
        def crop_and_resize(img):
            crop_percent = random.uniform(0.001, 0.005 * level)
            resize_percent = random.uniform(0.001, 0.005 * level)

            w, h = img.size
            crop_pixels_w = int(w * crop_percent)
            crop_pixels_h = int(h * crop_percent)

            cropped = img.crop((
                crop_pixels_w,
                crop_pixels_h,
                w - crop_pixels_w,
                h - crop_pixels_h
            ))

            new_width = int(w * (1 - resize_percent))
            new_height = int(h * (1 - resize_percent))
            resized = cropped.resize((new_width, new_height), Image.LANCZOS)

            final = resized.resize((w, h), Image.LANCZOS)
            return final

        modifications.append(crop_and_resize)

        # 2. Brightness adjustment
        def adjust_brightness(img):
            brightness_factor = 1 + random.uniform(-0.02 * level, 0.02 * level)
            enhancer = ImageEnhance.Brightness(img)
            return enhancer.enhance(brightness_factor)

        modifications.append(adjust_brightness)

        # 3. Contrast adjustment
        def adjust_contrast(img):
            contrast_factor = 1 + random.uniform(-0.015 * level, 0.015 * level)
            enhancer = ImageEnhance.Contrast(img)
            return enhancer.enhance(contrast_factor)

        modifications.append(adjust_contrast)

        # 4. Color adjustment
        def adjust_color(img):
            color_factor = 1 + random.uniform(-0.01 * level, 0.01 * level)
            enhancer = ImageEnhance.Color(img)
            return enhancer.enhance(color_factor)

        modifications.append(adjust_color)

        # 5. Add noise
        def add_noise(img):
            try:
                import numpy as np
                img_array = np.array(img)

                noise_intensity = level * 0.5
                noise = np.random.normal(0, noise_intensity, img_array.shape)

                noisy_img = img_array + noise
                noisy_img = np.clip(noisy_img, 0, 255)

                return Image.fromarray(noisy_img.astype('uint8'))
            except ImportError:
                return img

        modifications.append(add_noise)

        # 6. Modify histogram
        def modify_histogram(img):
            def curve(x, strength):
                return int(x + strength * (x - 128) * 0.01)

            strength_r = random.uniform(-level, level)
            strength_g = random.uniform(-level, level)
            strength_b = random.uniform(-level, level)

            r, g, b = img.split()

            r_table = [curve(i, strength_r) for i in range(256)]
            g_table = [curve(i, strength_g) for i in range(256)]
            b_table = [curve(i, strength_b) for i in range(256)]

            r_table = [max(0, min(255, x)) for x in r_table]
            g_table = [max(0, min(255, x)) for x in g_table]
            b_table = [max(0, min(255, x)) for x in b_table]

            r = r.point(r_table)
            g = g.point(g_table)
            b = b.point(b_table)

            return Image.merge('RGB', (r, g, b))

        modifications.append(modify_histogram)

        # Apply random modifications
        random.shuffle(modifications)
        num_modifications = min(level + 1, len(modifications))

        for modify in modifications[:num_modifications]:
            img = modify(img)

        # Save with quality variation while preserving iPhone-like HEIC extension when possible.
        quality_variation = random.randint(-2, 2)
        final_quality = max(85, min(98, 95 + quality_variation))
        output_ext = Path(img_path).suffix.lower()

        if output_ext in [".heic", ".heif"]:
            try:
                img.save(img_path, "HEIF", quality=final_quality)
            except Exception:
                img.save(img_path, "JPEG", quality=final_quality)
        else:
            img.save(img_path, "JPEG", quality=final_quality)
        return True

    except Exception as e:
        print(f"Erreur lors de la modification de l'image: {e}")
        return False


def process_batch(
    input_path,
    output_dir,
    versions_count,
    photos_per_batch,
    modification_level,
    verbose,
    progress_callback,
    flat_output=False,
    return_mappings=False,
):
    """
    Traite un lot de photos en créant plusieurs versions, avec un dossier par version contenant toutes les photos
    """

    photo_mappings = []

    print("\n===== TRAITEMENT D'IMAGES POUR SIMULATION IPHONE =====")
    print(f"Chemin d'entrée: {input_path}")
    print(f"Nombre de versions demandées: {versions_count}")
    print(f"Photos par batch: {'Toutes' if photos_per_batch == 0 else photos_per_batch}")
    print(f"Niveau de modification d'image: {modification_level}")
    print("=" * 55)

    # Find all images
    image_extensions = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.JPG', '.JPEG', '.PNG', '.HEIC', '.HEIF']

    if os.path.isfile(input_path):
        image_files = [input_path]
    else:
        image_files = []
        for ext in image_extensions:
            image_files.extend(glob.glob(os.path.join(input_path, f'*{ext}')))

    if not image_files:
        print(f"\n Aucune image trouvée dans {input_path}")
        return photo_mappings if return_mappings else None

    # Limit photos per batch if specified
    if photos_per_batch > 0 and len(image_files) > photos_per_batch:
        print(f"Limitation à {photos_per_batch} photos par batch (sur {len(image_files)} trouvées)")
        # Use set to ensure unique files
        unique_files = set()
        for file in image_files:
            normalized_path = os.path.normcase(os.path.abspath(file))
            unique_files.add(normalized_path)

        image_files = list(unique_files)[:photos_per_batch]

    # Seed random for reproducibility
    random.seed(int(datetime.now().timestamp()))

    # Create main output directory
    parent_dir = os.path.dirname(output_dir)
    main_output_dir = output_dir
    if flat_output:
        os.makedirs(main_output_dir, exist_ok=True)

    batch_folders = []

    # Process each version
    for batch_index in range(versions_count):
        if flat_output:
            batch_folder = main_output_dir
            if batch_folder not in batch_folders:
                batch_folders.append(batch_folder)
        else:
            batch_folder = os.path.join(main_output_dir, f"batch_{batch_index + 1}")
            os.makedirs(batch_folder, exist_ok=True)
            batch_folders.append(batch_folder)

        print(f"\nDossier de batch {batch_index + 1}: {batch_folder}")
        print(f"Traitement du batch {batch_index + 1}/{versions_count}")

        total_photos = len(image_files)
        processed_count = 0
        failed_count = 0

        for img_index, img_file in enumerate(image_files):
            try:
                print(f"\n  [{img_index + 1}/{total_photos}] Traitement de l'image: {os.path.basename(img_file)}")

                # Generate metadata
                iphone_model = generate_iphone_model()
                location_data = generate_random_location()
                date_data = generate_random_dates()
                camera_data = generate_camera_exif(iphone_model)

                if verbose:
                    print(f"    Modèle: {iphone_model}")
                    print(f"    GPS: {location_data['GPSPosition']}")
                    print(f"    Date création: {date_data['CreateDate']}")
                    print(f"    Date modification: {date_data['ModifyDate']}")
                    print(f"    ISO: {random.randint(*camera_data.get('iso_range', (25, 3200)))}")
                    print(f"    Ouverture: f/{camera_data['FNumber']}")
                    print(f"    Vitesse: {camera_data['ShutterSpeed']}")
                    print(f"    Focale: {camera_data['FocalLength']}")
                    print(f"    Objectif: {camera_data['LensModel']}")

                # Generate new filename
                base_name = generate_random_filename()
                original_ext = os.path.splitext(img_file)[1].lower()
                output_ext = ".HEIC" if original_ext in [".heic", ".heif"] else ".jpg"
                new_filename = f"{base_name}{output_ext}"

                target = os.path.join(batch_folder, new_filename)

                # Copy file
                try:
                    shutil.copy2(img_file, target)
                except Exception as e:
                    print(f"    ⚠ Erreur lors de la copie de l'image : {e}")
                    print(f"    ⚠ Impossible de copier le fichier : {img_file}")
                    failed_count += 1
                    continue

                # Apply image modifications
                if modification_level > 0 and PILLOW_AVAILABLE:
                    print(f"    Applique des modifications subtiles (niveau {modification_level})...")
                    if apply_subtle_modifications(target, modification_level):
                        print("    ✓ Modifications subtiles appliquées")
                    else:
                        print("    ⚠ Impossible d'appliquer les modifications subtiles")

                # Apply EXIF metadata
                exif_cmd = [
                    EXIFTOOL_CMD,
                    '-overwrite_original',
                    f'-Make=Apple',
                    f'-Model={iphone_model}',
                    f'-Software={camera_data["Software"]}',
                    f'-LensMake=Apple',
                    f'-LensModel={camera_data["LensModel"]}',
                    f'-CreateDate={date_data["CreateDate"]}',
                    f'-DateTimeOriginal={date_data["CreateDate"]}',
                    f'-ModifyDate={date_data["ModifyDate"]}',
                    f'-ISO={random.randint(25, 3200)}',
                    f'-FNumber={camera_data["FNumber"]}',
                    f'-ExposureTime={camera_data["ExposureTime"]}',
                    f'-FocalLength={camera_data["FocalLength"]}',
                    f'-GPSLatitudeRef={location_data["GPSLatitudeRef"]}',
                    f'-GPSLatitude={location_data["GPSLatitude"]}',
                    f'-GPSLongitudeRef={location_data["GPSLongitudeRef"]}',
                    f'-GPSLongitude={location_data["GPSLongitude"]}',
                    f'-GPSAltitude={location_data["GPSAltitude"]}',
                    '-ColorSpace=1',
                    target
                ]

                try:
                    result = subprocess.run(
                        exif_cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        check=False,
                    )

                    if result.returncode != 0:
                        print(f"    ⚠ Erreur lors de l'application des métadonnées: {result.stdout}")

                        # Try alternative method
                        temp_exif_file = f"exif_commands_{img_index}.txt"
                        with open(temp_exif_file, 'w', encoding='utf-8') as f:
                            f.write("-Make=Apple\n")
                            f.write(f"-Model={iphone_model}\n")
                            f.write(f"-GPSLatitude={location_data['GPSLatitude']}\n")

                        alt_cmd = [EXIFTOOL_CMD, '-@', temp_exif_file, target]
                        alt_result = subprocess.run(
                            alt_cmd,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            text=True,
                            check=False,
                        )

                        os.remove(temp_exif_file)

                        if alt_result.returncode == 0:
                            print("    ✓ Métadonnées appliquées avec la méthode alternative")
                        else:
                            print(f"    ✗ Échec de l'application des métadonnées: {alt_result.stdout}")
                    else:
                        print("    ✓ Métadonnées appliquées avec succès")

                    # Verify metadata
                    check_cmd = [EXIFTOOL_CMD, '-Make', '-Model', '-GPSLatitude', target]
                    check_result = subprocess.run(check_cmd, capture_output=True, text=True)

                    if verbose:
                        print(f"    Vérification des métadonnées: {check_result.stdout.strip()}")

                    if 'Apple' in check_result.stdout:
                        print(f"    ✓ Photo traitée avec succès: {new_filename}")
                        processed_count += 1
                        if return_mappings:
                            photo_mappings.append(
                                {
                                    "generated": new_filename,
                                    "original": os.path.basename(img_file),
                                }
                            )
                    else:
                        print("    ⚠ Les métadonnées pourraient ne pas avoir été correctement appliquées")
                        if verbose:
                            print(f"    Résultat de la vérification: {check_result.stdout}")

                except subprocess.CalledProcessError as e:
                    print(f"    ⚠ Erreur lors de l'application des métadonnées: {e}")
                    failed_count += 1

                # Update progress
                if progress_callback:
                    progress_callback(img_index + 1, total_photos)

            except Exception as e:
                print(f"    ⚠ Erreur générale lors du traitement de {img_file}: {e}")
                failed_count += 1
                traceback.print_exc()

        print(f"\nBatch {batch_index + 1} terminé:")
        print(f"  - Photos traitées avec succès: {processed_count}")
        print(f"  - Échecs: {failed_count}")

    # Summary
    print("\n===== RÉCAPITULATIF =====")
    print(f"Photos traitées avec succès: {processed_count * versions_count}")
    print(f"Échecs: {failed_count * versions_count}")
    print(f"Dossiers de sortie:")
    for folder in batch_folders:
        print(f"  - {folder}")
    print("=" * 25)

    if return_mappings:
        return photo_mappings


# ============================================================================
# Command Line Interface Helpers
# ============================================================================

def build_cli_parser():
    parser = argparse.ArgumentParser(
        description="iPhone EXIF Modifier - CLI mode"
    )
    parser.add_argument(
        "--cli",
        action="store_true",
        help="Execute without launching the GUI",
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT_DIR),
        help="Source folder or file containing photos to spoof",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Destination folder where spoofed photos will be written",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=3,
        help="Number of photos to process per batch",
    )
    parser.add_argument(
        "--versions",
        type=int,
        default=1,
        help="Number of batches to generate",
    )
    parser.add_argument(
        "--modification-level",
        type=int,
        default=2,
        help="Image modification level (0 disables subtle edits)",
    )
    parser.add_argument(
        "--flat-output",
        dest="flat_output",
        action="store_true",
        default=True,
        help="Write files directly into the output directory",
    )
    parser.add_argument(
        "--no-flat-output",
        dest="flat_output",
        action="store_false",
        help="Keep batch sub-folders in the output directory",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Reduce verbosity for automated pipelines",
    )
    return parser


def run_cli_mode(args):
    """Execute the tool in headless CLI mode"""
    photos_per_batch = max(1, int(args.count or 1))
    versions = max(1, int(args.versions or 1))
    modification_level = max(0, int(args.modification_level or 0))
    verbose = not args.quiet

    mappings = process_batch(
        args.input,
        args.output,
        versions,
        photos_per_batch,
        modification_level,
        verbose,
        progress_callback=None,
        flat_output=args.flat_output,
        return_mappings=True,
    ) or []

    if mappings:
        print("ORIGINAL_NAMES_START")
        for mapping in mappings:
            original = mapping.get("original", "")
            if original:
                print(f"ORIGINAL: {original}")
        print("ORIGINAL_NAMES_END")
        return 0

    print("⚠️  Aucun fichier généré lors de l'exécution en mode CLI.")
    return 1


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Point d'entrée principal du programme"""
    root = tk.Tk()
    app = IPhoneExifApp(root)
    root.mainloop()


if __name__ == '__main__':
    parser = build_cli_parser()
    cli_args = parser.parse_args()

    if cli_args.cli:
        sys.exit(run_cli_mode(cli_args))

    main()
