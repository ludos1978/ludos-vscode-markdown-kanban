#!/Users/rspoerri/_SYNC/_SYSTEM/py312-venv/bin/python3

import os, subprocess, re, sys
from pathlib import Path
import argparse
import datetime
import shutil
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import logging
import threading

# Set up logging
# logging.basicConfig(level=logging.DEBUG,
# 					format='%(asctime)s - %(message)s',
# 					datefmt='%Y-%m-%d %H:%M:%S')
# logger = logging.getLogger()


# return a list of found !!!include(./filenames.md)!!! in the given filename
def find_includes(filename):
	"""Return both original paths and their resolved targets, plus all parent directories to watch"""
	original_files = set()
	resolved_files = set()
	directories_to_watch = set()
	
	files_to_process = [filename]

	while files_to_process:
		current_file = files_to_process.pop()

		# Skip if already processed
		if current_file in original_files:
			continue

		# Add the current file to the set of original files
		original_files.add(current_file)
		
		# Get and store the resolved path
		resolved_path = Path(current_file).resolve()
		resolved_files.add(resolved_path)
		
		# Add the parent directory of the resolved path to watch
		directories_to_watch.add(resolved_path.parent)

		try:
			with open(current_file, 'r') as file:
				content = file.read()

				# Find all includes
				pattern = r'!!!include\((.*?)\)!!!'
				matches = re.findall(pattern, content)

				for match in matches:
					# Construct the full path for the found filename
					include_file = os.path.join(os.path.dirname(current_file), match)
					# Add to process list if not already handled
					if include_file not in original_files and include_file not in files_to_process:
						files_to_process.append(include_file)

		except FileNotFoundError:
			print(f"File not found: {current_file}")
		except Exception as e:
			print(f"Error processing file {current_file}: {e}")

	return list(original_files), list(resolved_files), list(directories_to_watch)

class FileWatcher(FileSystemEventHandler):
	def __init__(self, main_file, command, stop_event, args):
		self.main_file_path = Path(main_file)
		self.main_file_resolved = self.main_file_path.resolve()
		
		# Get the file lists and all directories that need watching
		self.original_filenames, self.resolved_filenames, self.directories_to_watch = find_includes(main_file)
		
		self.command = command
		self.stop_event = stop_event
		self.app_args = args
		
		# Map of real paths to their original symlinks
		self.real_to_original_map = {Path(f).resolve(): Path(f) for f in self.original_filenames}
		
		if (args.verbose):
			print(f'FileWatcher.__init__: watching {len(self.original_filenames)} files')
			print(f'Directories to watch: {len(self.directories_to_watch)}')
			
	def on_any_event(self, event):
		if self.app_args.verbose:
			print(f'FileWatcher.on_any_event: {event.src_path} (type: {event.event_type})')
		
		# Skip directory events and .swp files from editors like vim
		if event.is_directory or event.src_path.endswith('.swp'):
			return
			
		# Get both paths for the event
		event_path = Path(event.src_path)
		try:
			resolved_event_path = event_path.resolve()
		except (FileNotFoundError, OSError):
			# File might have been deleted, try to handle it anyway
			resolved_event_path = event_path
		
		# Check if this is the main file
		if (event_path == self.main_file_path or resolved_event_path == self.main_file_resolved):
			if self.app_args.verbose:
				print(f'Main file changed, refreshing includes')
			# Refresh watched files
			self.original_filenames, self.resolved_filenames, self.directories_to_watch = find_includes(self.main_file_path)
			self.real_to_original_map = {Path(f).resolve(): Path(f) for f in self.original_filenames}
		
		# Check if the changed file is one we should care about
		is_watched_file = (
			event_path in self.original_filenames or 
			resolved_event_path in self.resolved_filenames
		)
		
		# Skip if it's the main file or not a watched file
		if not is_watched_file or resolved_event_path == self.main_file_resolved:
			if self.app_args.verbose:
				print(f'Ignoring event for {event_path} (not in watch list or is main file)')
			return
			
		if self.app_args.verbose:
			print(f'Watched file modified: {event_path}')
		self._handle_file_modified()

	def _handle_file_modified(self):
		if self.app_args.verbose:
			print(f'Triggering update by touching main file: {self.main_file_path}')
		# Touch the main file to trigger marp update
		self.main_file_path.touch(exist_ok=True)

def run_observer(event_handler, directories_to_watch, stop_event):
	"""Run multiple observers, one for each directory that needs watching"""
	observers = []
	
	# Create an observer for each directory
	for directory in directories_to_watch:
		observer = Observer()
		observer.schedule(event_handler, path=str(directory), recursive=False)
		observer.start()
		observers.append(observer)
	
	# Wait for stop event
	try:
		while not stop_event.is_set():
			stop_event.wait(1)
	finally:
		# Stop all observers on exit
		for observer in observers:
			observer.stop()
		
		for observer in observers:
			observer.join()

def run_marp(marp_parameters, input_filename, absolute_working_directory, handout_env=None):
	command = marp_parameters
	filename = input_filename
	print(f"calling marp: {" ".join(marp_parameters)}\n{input_filename}\n{absolute_working_directory}")

	stop_event = threading.Event()
	event_handler = FileWatcher(filename, command, stop_event, args)

	# Build environment with handout settings if provided
	env = os.environ.copy()
	if handout_env:
		env.update(handout_env)
		print(f"[Handout mode] Environment: {handout_env}")

	# Start marp process
	event_handler.process = subprocess.Popen(command, env=env)
	
	# Start observers for all needed directories
	observer_thread = threading.Thread(
		target=run_observer, 
		args=(event_handler, event_handler.directories_to_watch, stop_event)
	)
	observer_thread.start()
	
	try:
		# Keep main thread running
		event_handler.process.wait()
	except KeyboardInterrupt:
		stop_event.set()
		if event_handler.process:
			event_handler.process.terminate()
	finally:
		stop_event.set()
		observer_thread.join()


def run_app(input_filenames, args):
	# print ("len " + str(len(input_filenames)))

	# Get path of app
	marp_program_name = 'marp'
	marp_program_path = shutil.which(marp_program_name)
	if not marp_program_path:
		print (f"marp executable not found by python shutil ({marp_program_path})")
		marp_program_path = "/opt/homebrew/bin/marp"
		print (f"assuming brew installed marp path ({marp_program_path})")

	monolith_program_name = 'monolith'
	monolith_program_path = shutil.which(monolith_program_name)
	if not monolith_program_path:
		print (f"monolith executable not found by python shutil ({marp_program_path})")

	current_working_directory = Path('.').absolute()
	export_folder = Path("_Export_HTML")

	if (export_folder.exists()):
		if (export_folder.is_dir()):
			# path exists and is dir
			pass
		else:
			# path exists but is file
			print (f"export path blocked by file {export_folder}")
	else:
		export_folder.mkdir(parents=True, exist_ok=True)


	for input_filename in input_filenames:

		document_filename = Path(input_filename)
		output_format = "html"

		# working_directory = document_filename.parent.absolute()
		try:
			relative_working_directory = document_filename.parent.absolute().relative_to(current_working_directory)
		except Exception as e:
			relative_working_directory = Path(".")
			# this might happen if working in a symlinked folder
			print (f"Error: {str(e)}\ndocument_filename: {document_filename}\ncurrent_working_directory: {current_working_directory}")
		absolute_working_directory = relative_working_directory.absolute()

		print("marped.py: " + str(datetime.datetime.now()))

		input_filename = document_filename.name
		output_filename = Path(document_filename.stem + "-" + str(datetime.datetime.now().strftime("%Y%m%d_%H%M")) + "." + output_format) # %S

		print(f"		file path: ./{str(relative_working_directory)}/")
		# print(f"   input_filename: {str(input_filename)}")
		# print(f"  output_filename: {str(output_filename)}")

		input_filepath = relative_working_directory / input_filename
		marp_output_filepath = relative_working_directory / output_filename
		print("   input_filepath: " + str(input_filepath))
		print("  marp_output_filepath: " + str(marp_output_filepath))

		# marp paths and parameters
		marppresenterpath="/Users/rspoerri/_SYNC/_SYSTEM/_MarpEngine"

		engine_parameter = marppresenterpath + "/engine.js"
		theme_parameter  = marppresenterpath + "/themes/"

		marp_parameters = [
			f'{marp_program_path}',
			f'{input_filename}',
			'--allow-local-files',
			'--html',
			'--theme-set', f'{theme_parameter}',
			'--engine', f'{engine_parameter}',
			'-o', f'{marp_output_filepath}',
		]

		if (not args.pack) and args.preview:
			marp_parameters.append('--preview')
			marp_parameters.append('--watch')
		
		if args.verbose:
			marp_parameters.append('--debug=true')

		# Build handout environment if enabled
		handout_env = None
		if args.handout:
			handout_env = {
				'MARP_HANDOUT': 'true',
				'MARP_HANDOUT_LAYOUT': args.handout_layout,
				'MARP_HANDOUT_SLIDES_PER_PAGE': str(args.handout_slides_per_page)
			}
			print(f"[Handout] Generating handout with layout={args.handout_layout}, slides_per_page={args.handout_slides_per_page}")

		# run marp
		try:
			run_marp(marp_parameters, input_filename, absolute_working_directory, handout_env)

		except Exception as e:
			print (f"Exception when running marp: {e}")
			pass

		finally:
			# if we viewed with preview (automatic browser openened, also remove the file after viewing)
			if (not args.pack) and args.preview:
				print (f"Removing file after generating: {marp_output_filepath}")
				os.remove(marp_output_filepath)

		# Post-process for handout mode (only for non-preview exports)
		if args.handout and not args.preview and marp_output_filepath.exists():
			print(f"[Handout] Post-processing: {marp_output_filepath}")
			# Get path to handout post-processor script (same directory as this script)
			script_dir = Path(__file__).parent.resolve()
			postprocess_script = script_dir / "handout-postprocess.js"

			if postprocess_script.exists():
				postprocess_params = [
					'node',
					str(postprocess_script),
					str(marp_output_filepath)
				]
				postprocess_env = os.environ.copy()
				postprocess_env['MARP_HANDOUT_LAYOUT'] = args.handout_layout
				postprocess_env['MARP_HANDOUT_SLIDES_PER_PAGE'] = str(args.handout_slides_per_page)

				try:
					result = subprocess.run(postprocess_params, env=postprocess_env, capture_output=True, text=True)
					if result.returncode == 0:
						print(f"[Handout] Post-processing complete")
					else:
						print(f"[Handout] Post-processing error: {result.stderr}")
				except Exception as e:
					print(f"[Handout] Post-processing failed: {e}")
			else:
				print(f"[Handout] Post-processor not found: {postprocess_script}")

		if False:
			print(f"Executing command: {' '.join(parameters)}")
			print(f"			  cwd: {relative_working_directory}")
			print(f'args: \n{result.args}')
			print(f'Output: \n{result.stdout}')
			print(f'Error: \n{result.stderr}')

		if (args.pack):
			if (not marp_output_filepath.exists()):
				print (f"some error creating marp file {marp_output_filepath}, file does not exist")
			else:
				monolith_output_filepath = relative_working_directory / export_folder / output_filename
				print("  monolith_output_filepath: " + str(monolith_output_filepath))

				monolith_parameters = [
					f'{monolith_program_path}',
					#'-', # when piping content into monolith, has caused problems
					f'{marp_output_filepath}',
					'-o', f'{monolith_output_filepath}',
					'-B', # use as blacklist
					'-d', '.particify.de',
					# '-d', 'ars.particify.de',
					# '-d', 'https://ars.particify.de'
				]
				print(f" monolith parameters {(" ".join(monolith_parameters))}")
				monolith_result = None
				try:
					monolith_result = subprocess.run(monolith_parameters, cwd=relative_working_directory)
					# using pipe ( - parameter ) to feed file contents, doesnt work right?
					# monolith_result = subprocess.run(monolith_parameters, cwd=relative_working_directory, input=open(marp_output_filepath, 'r').read().encode('utf-8')) # , text=True, capture_output=True,
				except subprocess.CalledProcessError as e:
					print (f"ERROR: running monolith {e}")
					exit(1)
				finally:
					if (monolith_result.returncode not in [0,None]):
						print (f"ERROR: monolith exited with error {monolith_result}")
						exit(1)

				# remove marp generated file
				if (marp_output_filepath.exists() and (os.path.splitext(marp_output_filepath)[1] == ".html")):
					print (f"removing html source file {marp_output_filepath}")
					os.remove(marp_output_filepath)
					pass
				else:
					print (f"skip removing file, not a html {marp_output_filepath} {os.path.splitext(marp_output_filepath)}")

				if (args.preview):
					print (f"previewing {monolith_output_filepath}")
					chrome_working_directory = os.path.abspath(relative_working_directory)
					monolith_output_fullpath = os.path.abspath(monolith_output_filepath)

					chrome_parameters = [
						'open',
						'-a', "Google Chrome",
						'--args',
						f'{monolith_output_fullpath}',
						'--disable-features=Translate',
						'--disable-translate',
					]
					print (f"command line parameters for chrome {' '.join(chrome_parameters)} in {chrome_working_directory} open {monolith_output_fullpath}")
					result = subprocess.call(chrome_parameters, cwd=chrome_working_directory)
					# run without blocking
					# subprocess.Popen(chrome_parameters, cwd=chrome_working_directory)

if __name__ == "__main__":
	parser = argparse.ArgumentParser()
	parser.add_argument('positional_arg', nargs='+', help='files to convert')
	# parser.add_argument('-p', '--preview', dest='preview', action='store_true', help='preview')
	parser.add_argument('-c', '--pack', dest='pack', action='store_true', help='pack html with all content')
	parser.add_argument('-p', '--preview', dest='preview', action='store_true', help='preview output')
	parser.add_argument('-v', '--verbose', dest='verbose', action='store_true', help='verbose output')
	parser.add_argument('-H', '--handout', dest='handout', action='store_true', help='generate handout format (slides + notes)')
	parser.add_argument('--handout-layout', dest='handout_layout', choices=['portrait', 'landscape'], default='portrait', help='handout layout (default: portrait)')
	parser.add_argument('--handout-slides-per-page', dest='handout_slides_per_page', type=int, choices=[1, 2, 3, 4, 6], default=1, help='slides per page for handout (default: 1)')
	args = parser.parse_args()
	run_app(args.positional_arg, args)
