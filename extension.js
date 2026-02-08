'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
function activate(context) {
    console.log("glsl-linter extension is now active");
    // Create a linter class instance and its controller
    let linter = new GodotComputeShaderLinter(context);
    let linterController = new GodotComputeShaderLinterController(linter);
    // Register the linter
    context.subscriptions.push(linter);
    context.subscriptions.push(linterController);
}
exports.activate = activate;
function deactivate() {
}
exports.deactivate = deactivate;
// Performs GLSL language linting
class GodotComputeShaderLinter {
    constructor(context) {
        this.diagnosticsCollection = vscode.languages.createDiagnosticCollection();
        this.extensionPath = context.extensionPath;
    }

    // Recursively process include files and return content with line count
    processIncludeFile(includePath, currentDir, processedFiles, diagnostics, includeLineNumber) {
        // Resolve relative path
        let absolutePath;
        if (path.isAbsolute(includePath)) {
            absolutePath = includePath;
        } else {
            absolutePath = path.resolve(currentDir, includePath);
        }

        // Check for circular references
        if (processedFiles.has(absolutePath)) {
            console.warn("Godot Compute Shader Linter: Circular reference detected in include file: " + absolutePath);
            let message = "Circular reference detected in include file: " + absolutePath;
            let where = new vscode.Range(includeLineNumber, 0, includeLineNumber, 0);
            let diag = new vscode.Diagnostic(where, message, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diag);
            return { content: "", lineCount: 0 };
        }
        processedFiles.add(absolutePath);

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
            console.warn("Godot Compute Shader Linter: Include file not found: " + absolutePath);
            let message = "Include file not found: " + absolutePath;
            let where = new vscode.Range(includeLineNumber, 0, includeLineNumber, 0);
            let diag = new vscode.Diagnostic(where, message, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diag);
            return { content: "", lineCount: 0 };
        }

        // Read file content
        let content = "";
        try {
            content = fs.readFileSync(absolutePath, 'utf8');
        } catch (err) {
            console.error("Godot Compute Shader Linter: Error reading include file: " + absolutePath, err);
            let message = "Error reading include file: " + absolutePath + " - " + err.message;
            let where = new vscode.Range(includeLineNumber, 0, includeLineNumber, 0);
            let diag = new vscode.Diagnostic(where, message, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diag);
            return { content: "", lineCount: 0 };
        }

        // Split into lines
        let lines = content.split(/\r?\n/);
        let processedContent = "";
        let lineCount = 0;

        // Process each line
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Skip #[compute] line in include files
            if (i === 0 && line.startsWith("#[compute]")) {
                continue;
            }

            // Check for nested includes
            let includeMatch = line.match(/#include\s+"([^"]+)"/);
            if (includeMatch) {
                let nestedIncludePath = includeMatch[1];
                let nestedResult = this.processIncludeFile(nestedIncludePath, path.dirname(absolutePath), new Set(processedFiles), diagnostics, includeLineNumber);
                processedContent += nestedResult.content;
                lineCount += nestedResult.lineCount;
            } else {
                processedContent += line + "\n";
                lineCount++;
            }
        }

        return { content: processedContent, lineCount: lineCount };
    }

    // Adjust line number based on include files
     adjustLineNumber(errorLine, includeLineMap, includeRangeMap, godotShader, hasVersion) {
        let adjustedLine = errorLine;
        let maxIncludeLine = 0;
        let maxAccumulatedLines = 0;

        // Check if error is within an include file's range
        // Note: errorLine is 0-based from validator output
        let errorLineInProcessedContent = errorLine + 1; // Convert to 1-based for range map lookup

        if (includeRangeMap.has(errorLineInProcessedContent)) {
            // Error is in an include file, return the include line number
            let includeLine = includeRangeMap.get(errorLineInProcessedContent);
            return includeLine;
        }

        // Find the last include before the error line
        for (const [includeLine, accumulatedLines] of includeLineMap) {
            if (includeLine <= errorLine && includeLine > maxIncludeLine) {
                maxIncludeLine = includeLine;
                maxAccumulatedLines = accumulatedLines;
            }
        }

        // Adjust line number by subtracting accumulated lines from includes
        adjustedLine = errorLine - maxAccumulatedLines;

        // Godot Shader requires additional +1 adjustment (original logic)
        if (godotShader)
            adjustedLine++;
        
        if (!hasVersion)
            adjustedLine--;

        return adjustedLine;
    }

    // Does the actual linting
    lint(doc) {
        // Only accept GLSL files
        if (doc.languageId !== "glsl") {
            return;
        }
        // Get configuration
        const config = vscode.workspace.getConfiguration("godot-compute-shader-linter");
        
        // Set default validatorPath if not configured
        let validatorPath = config.validatorPath;
        if (!validatorPath || validatorPath === "") {
            // Use platform-specific binary name
            const isWindows = process.platform === 'win32';
            const binaryName = isWindows ? 'glslangValidator.exe' : 'glslangValidator';
            validatorPath = `bin/${binaryName}`;
        }
        
        // Resolve the validator path to an absolute path
        if (!path.isAbsolute(validatorPath)) {
            // Resolve relative to extension installation path
            validatorPath = path.join(this.extensionPath, validatorPath);
        }
        
        console.log("Godot Compute Shader Linter: Using validator path: " + validatorPath);
        
        // Check if validator exists
        if (!fs.existsSync(validatorPath)) {
            vscode.window.showErrorMessage("Godot Compute Shader Linter: glslangValidator not found at path: " + validatorPath);
            return;
        }
        // Try to guess what type of shader we're editing based on file extension
        let shaderStage = "";
        
        // Set default fileExtensions if not configured
        let fileExtensions = config.fileExtensions;
        if (!fileExtensions || typeof (fileExtensions) !== "object" || Object.keys(fileExtensions).length === 0) {
            fileExtensions = { ".comp.glsl": "comp" };
        }
        
        for (let ext in fileExtensions) {
            let shaderType = fileExtensions[ext];
            if (doc.fileName.endsWith(ext)) {
                // If the guess would be ambiguous, do not guess
                if (shaderStage === "") {
                    shaderStage = shaderType;
                }
                else {
                    shaderStage = "";
                    vscode.window.showWarningMessage("Godot Compute Shader Linter: current file extension matches at least two shader types!");
                }
            }
        }
        // These are diagnostic messages for this file
        let diagnostics = [];
        // Validator arguments
        let validatorArguments = [doc.fileName];
        if (shaderStage !== "") {
            validatorArguments = validatorArguments.concat(["--stdin"]);
            validatorArguments = validatorArguments.concat(["-S", shaderStage]);
            validatorArguments = validatorArguments.concat(["--error-column"]);
            validatorArguments = validatorArguments.concat(["--target-env", "vulkan1.4"]);
        }
        // Extra arguments are prepended
        const extraValidatorArguments = config.validatorArgs;
        if (extraValidatorArguments !== null && Array.isArray(extraValidatorArguments)) {
            validatorArguments = validatorArguments.concat(extraValidatorArguments);
        }

        // DEBUG
        // console.log( validatorArguments.join( "|" ) );
        // Spawn the validator process
        let validatorProcess = cp.spawn(validatorPath, validatorArguments, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Create dictionaries to store include information
        let includeLineMap = new Map(); // key: include line number, value: accumulated line count before this include
        let includeRangeMap = new Map(); // key: start line in processed content, value: include line number
        let godotShader = false;
        let accumulatedLines = 0;
        let processedLines = 0; // Track lines in processed content
        let docDir = path.dirname(doc.fileName);
        let hasVersion = false;
        let hasMain = false;

        for (let i = 0; i < doc.lineCount; i++) {
            let line = doc.lineAt(i).text;

            if (!hasVersion && line.match("^#version")) {
                hasVersion = true;
                break;
            }
        }
        if (!hasVersion)
            validatorProcess.stdin.write("#version 450\n");

        // Process each line
        for (let i = 0; i < doc.lineCount; i++) {
            let line = doc.lineAt(i).text;

            // Check for Godot Shader marker
            if (i == 0 && line.startsWith("#[compute]")) {
                godotShader = true;
                continue;
            }
            
            if (line.match("void +main *\\\( *\\\)"))
                hasMain = true;

            // Check for include statement
            let includeMatch = line.match(/#include\s+"([^"]+)"/);
            if (includeMatch) {
                let includePath = includeMatch[1];
                let result = this.processIncludeFile(includePath, docDir, new Set(), diagnostics, i);
                
                // Map the range of included content to the include line number
                // The included content starts at current processedLines and spans result.lineCount lines
                let includeStartLine = processedLines + 1; // +1 because processed lines are 0-based
                let includeEndLine = includeStartLine + result.lineCount;
                for (let lineNum = includeStartLine; lineNum <= includeEndLine; lineNum++) {
                    includeRangeMap.set(lineNum, i);
                }

                // Write include file content to stdin
                validatorProcess.stdin.write(result.content);

                // Update counters
                accumulatedLines += result.lineCount - 1;
                processedLines += result.lineCount;

                // Record in dictionaries
                includeLineMap.set(i, accumulatedLines);
            } else {
                // Write regular line to stdin
                validatorProcess.stdin.write(line + "\n");
                processedLines++;
            }
        }
        if (!hasVersion && !hasMain)
            validatorProcess.stdin.write("void main() {}\n");

        validatorProcess.stdin.end();

        // If the validator is running
        if (validatorProcess.pid) {
            let validatorOutput = "";
            validatorProcess.stdout.on("data", (data) => { validatorOutput += data; });
            /*
             * It seems that glglangValidators returns 0 when there are no errors,
             * 1 if there's a problem with the invocation and 2 if there are compilation errors.
             * Therefore only exit code 1 is handled here.
             */
            validatorProcess.on("exit", (code) => {
                // DEBUG
                // console.log("glslangValidator exit code: " + code);
                if (code == 1) {
                    vscode.window.showErrorMessage("Godot Compute Shader Linter: GLSL validator returned exit code 1!");
                    return;
                }
            });
            // When validator finishes its job (closes stream)
            validatorProcess.stdout.on("close", () => {
                //console.log(validatorOutput.toString());

                let lines = validatorOutput.toString().split(/(?:\r\n|\r|\n)/g);
                // DEBUG
                // console.log(validatorOutput.toString());
                // console.log(lines);
                // Run analysis for each output line
                let finish = false;
                lines.forEach(line => {
                    if (finish) {
                        return;
                    }
                    if (line.includes("compilation errors")) {
                        finish = true;
                        return;
                    }
                    // Skip empty lines
                    if (line === "") {
                        return;
                    }
                    if (line.includes("compilation terminated")) {
                        return;
                    }

                    // Determine the severity of the error
                    let severity = vscode.DiagnosticSeverity.Hint;
                    if (line.startsWith("ERROR:")) {
                        severity = vscode.DiagnosticSeverity.Error;
                    }
                    else if (line.startsWith("WARNING:")) {
                        severity = vscode.DiagnosticSeverity.Warning;
                    }
                    // Check if the line contained an error information
                    // Hint severity is used as "no error" here
                    if (severity !== vscode.DiagnosticSeverity.Hint) {
                        // Parse the error message (if columns are specified)
                        let matches = line.match(/WARNING:|ERROR:\s(.*):(\d*):(\d*): '(.*)' : (.*)/);
                        if (matches && matches.length === 6) {
                            // Get the matched info
                            let lineNumber = parseInt(matches[2]) - 1;
                            // Adjust line number based on include files and Godot Shader
                            lineNumber = this.adjustLineNumber(lineNumber, includeLineMap, includeRangeMap, godotShader, hasVersion);
                            let colNumber = parseInt(matches[3]) - 1;
                            let code = matches[4];
                            let message = matches[5];
                            // Create a diagnostic message
                            let where = new vscode.Range(lineNumber, colNumber, lineNumber, colNumber + code.length);
                            let diag = new vscode.Diagnostic(where, message, severity);
                            diagnostics.push(diag);
                        }
                        else {
                            // Also handle global messages
                            matches = line.match(/WARNING:|ERROR: (.*)/);
                            if (matches && matches.length === 2) {
                                // DEBUG
                                // console.log("found global error");
                                // Get the matched info
                                let message = matches[1];
                                // Ignore those useless messages
                                if (message.endsWith("compilation errors.  No code generated."))
                                    return;
                                // Create a diagnostic message on the 1st char of the file
                                let where = new vscode.Range(0, 0, 0, 0);
                                let diag = new vscode.Diagnostic(where, message, severity);
                                diagnostics.push(diag);
                            }
                        }
                    }
                });
                // After the output is processed, push the new diagnostics to collection
                this.diagnosticsCollection.set(doc.uri, diagnostics);
            });
        }
        else {
            vscode.window.showErrorMessage("Godot Compute Shader Linter: failed to run GLSL validator!");
            return;
        }
    }
    dispose() {
        this.diagnosticsCollection.clear();
        this.diagnosticsCollection.dispose();
    }
}
// Controls the GodotComputeShaderLinter class
class GodotComputeShaderLinterController {
    // Creates a new linter controller
    constructor(linter) {
        this._linter = linter;
        let subscriptions = [];
        // Linter triggers
        vscode.workspace.onDidOpenTextDocument(this.lintTrigger, this, subscriptions);
        vscode.workspace.onDidSaveTextDocument(this.lintTrigger, this, subscriptions);
        this._disposable = vscode.Disposable.from(...subscriptions);
    }
    // Dispose method
    dispose() {
        this._disposable.dispose();
    }
    // Executed whenever linting shall be done
    lintTrigger() {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            this._linter.lint(editor.document);
        }
    }
}
//# sourceMappingURL=extension.js.map