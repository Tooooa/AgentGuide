import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, PresentationControls, useCursor, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// Configuration
const PAGE_WIDTH = 3;
const PAGE_HEIGHT = 4.2;
const PAGE_DEPTH = 0.03;
const COVER_DEPTH = 0.08; // Thicker cover for more presence
const CORNER_RADIUS = 0.12;
const ROUGHNESS = 0.3;
const METALNESS = 0.0;

interface PageProps {
    number: number;
    opened: boolean;
    totalPages: number;
    frontTexture?: THREE.Texture | null;
    backTexture?: THREE.Texture | null;
    isLeftPage?: boolean;
    currentSpread: number;
    visible?: boolean;
}

function Page({ number, opened, totalPages, frontTexture, backTexture, isLeftPage = false, currentSpread, visible = true }: PageProps) {
    const group = useRef<THREE.Group>(null);
    const meshRef = useRef<THREE.Mesh>(null);

    const zRef = useRef(0);
    const opacityRef = useRef(visible ? 1 : 0);
    
    useFrame((_, delta) => {
        if (!group.current) return;

        // All pages rotate around the spine (x=0)
        const targetRotation = opened ? -Math.PI : 0;
        
        const rotDiff = targetRotation - group.current.rotation.y;
        
        // Smoother easing
        const easing = 1 - Math.pow(1 - 0.06, delta * 60);
        group.current.rotation.y += rotDiff * easing;

        const progress = Math.max(0, Math.min(1, -group.current.rotation.y / Math.PI));
        
        // Z position - ensure proper stacking
        const spacing = 0.008;
        const frontZ = 0.5;
        
        let targetZ: number;
        
        // The page that just flipped (showing its back as left side) and 
        // the next page (showing its front as right side) should be at front
        const isCurrentLeftPage = opened && number === currentSpread - 1;
        const isCurrentRightPage = !opened && number === currentSpread;
        
        if (isCurrentLeftPage || isCurrentRightPage) {
            // Current visible pages at front
            targetZ = frontZ;
        } else if (number < currentSpread - 1) {
            // Already flipped pages - stack behind, further back for older pages
            targetZ = frontZ - 0.05 - (currentSpread - 1 - number) * spacing;
        } else if (number >= currentSpread) {
            // Not yet flipped pages - stack behind
            targetZ = frontZ - (number - currentSpread + 1) * spacing;
        } else {
            targetZ = frontZ - 0.02;
        }
        
        // Smoothly animate Z position
        zRef.current += (targetZ - zRef.current) * easing;

        // Elegant lift curve
        const liftHeight = 1.8;
        const liftCurve = Math.sin(progress * Math.PI);
        const lift = liftCurve * liftHeight;
        
        // Slight forward tilt during flip
        const tiltAmount = liftCurve * 0.08;
        group.current.rotation.x = tiltAmount;

        group.current.position.z = zRef.current + lift;
    });

    const isCover = number === 0;

    // Create rounded corner mask
    const roundedMask = useMemo(() => {
        const canvas = document.createElement('canvas');
        const size = 1024;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const r = (CORNER_RADIUS / PAGE_WIDTH) * size;
        
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, size, size);
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(size - r, 0);
        ctx.quadraticCurveTo(size, 0, size, r);
        ctx.lineTo(size, size - r);
        ctx.quadraticCurveTo(size, size, size - r, size);
        ctx.lineTo(r, size);
        ctx.quadraticCurveTo(0, size, 0, size - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }, []);

    // Define materials array
    const materialArray = useMemo(() => {
        // Edge material - rich brown for paper edges with slight texture feel
        const sideMat = new THREE.MeshStandardMaterial({ 
            color: isCover ? '#5D4037' : '#A1887F',
            roughness: 0.7,
            metalness: 0.0
        });

        // Paper color - warm antique paper tone
        const paperColor = '#E8DCC8';
        
        // Cover has richer, darker appearance
        const coverColor = '#4E342E';

        // FRONT face
        let frontMat;
        if (frontTexture) {
            frontMat = new THREE.MeshStandardMaterial({
                map: frontTexture,
                alphaMap: roundedMask,
                transparent: true,
                roughness: isCover ? 0.4 : ROUGHNESS,
                metalness: isCover ? 0.05 : METALNESS,
                color: '#ffffff',
                envMapIntensity: 0.3
            });
        } else {
            frontMat = new THREE.MeshStandardMaterial({
                color: isCover ? coverColor : paperColor,
                alphaMap: roundedMask,
                transparent: true,
                roughness: isCover ? 0.5 : ROUGHNESS,
                metalness: METALNESS,
                envMapIntensity: 0.2
            });
        }

        // BACK face
        let backMat;
        if (backTexture) {
            backMat = new THREE.MeshStandardMaterial({
                map: backTexture,
                alphaMap: roundedMask,
                transparent: true,
                roughness: ROUGHNESS,
                metalness: METALNESS,
                color: '#ffffff',
                envMapIntensity: 0.3
            });
        } else {
            backMat = new THREE.MeshStandardMaterial({ 
                color: isCover ? coverColor : paperColor,
                alphaMap: roundedMask,
                transparent: true,
                roughness: isCover ? 0.5 : ROUGHNESS,
                metalness: METALNESS,
                envMapIntensity: 0.2
            });
        }

        return [sideMat, sideMat, sideMat, sideMat, frontMat, backMat];
    }, [isCover, frontTexture, backTexture, roundedMask]);

    return (
        <group ref={group}>
            {/* Page pivot point and position */}
            <group position={[PAGE_WIDTH / 2, 0, 0]}>
                <mesh ref={meshRef} material={materialArray} castShadow receiveShadow>
                    <boxGeometry args={[PAGE_WIDTH, PAGE_HEIGHT, isCover ? COVER_DEPTH : PAGE_DEPTH]} />
                </mesh>
            </group>
        </group>
    );
}

const Book = ({ pageIndex, setTotalPages, setCurrentPage }: { pageIndex: number, setTotalPages: (n: number) => void, setCurrentPage: (n: number) => void }) => {
    const [hovered, setHover] = useState(false);
    const groupRef = useRef<THREE.Group>(null);
    const positionRef = useRef(-PAGE_WIDTH / 2);
    useCursor(hovered);
    
    // Animate book position: centered when closed, shifted left when open
    useFrame((_, delta) => {
        if (!groupRef.current) return;
        
        // When pageIndex is 0 (cover), book is centered (shift left by half page width)
        // When pageIndex > 0 (opened), book stays at origin so spine is at center
        const targetX = pageIndex === 0 ? -PAGE_WIDTH / 2 : 0;
        
        const easing = 1 - Math.pow(1 - 0.06, delta * 60);
        positionRef.current += (targetX - positionRef.current) * easing;
        
        groupRef.current.position.x = positionRef.current;
    });

    // Load cover
    const coverTexture = useTexture('/book_cover.png');
    coverTexture.colorSpace = THREE.SRGBColorSpace;

    // Load all spread textures (01-10)
    const spreadTextures = useTexture([
        '/book_spread_01.png',
        '/book_spread_02.png',
        '/book_spread_03.png',
        '/book_spread_04.png',
        '/book_spread_05.png',
        '/book_spread_06.png',
        '/book_spread_07.png',
        '/book_spread_08.png',
        '/book_spread_09.png',
        '/book_spread_10.png',
    ]);
    
    // Set color space for all spreads
    spreadTextures.forEach(tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
    });

    // Load last page
    const lastTexture = useTexture('/book_last.png');
    lastTexture.colorSpace = THREE.SRGBColorSpace;

    // Split each spread into left and right halves (including last page)
    const spreads = useMemo(() => {
        const allSpreads = [...spreadTextures, lastTexture].map(spreadTexture => {
            const left = spreadTexture.clone();
            left.colorSpace = THREE.SRGBColorSpace;
            left.offset.set(0, 0);
            left.repeat.set(0.5, 1);
            left.needsUpdate = true;

            const right = spreadTexture.clone();
            right.colorSpace = THREE.SRGBColorSpace;
            right.offset.set(0.5, 0);
            right.repeat.set(0.5, 1);
            right.needsUpdate = true;

            return { left, right };
        });
        return allSpreads;
    }, [spreadTextures, lastTexture]);

    // Total pages: cover + 11 spread right pages = 12 pages
    const totalPages = 12;
    
    useEffect(() => {
        setTotalPages(11); // 12 navigation points: 0=cover, 1-11=spreads
        setCurrentPage(pageIndex);
    }, [pageIndex, setTotalPages, setCurrentPage]);

    // Build all pages
    const allPages = [];
    
    // Cover page (page 0)
    allPages.push(
        <Page
            key={0}
            number={0}
            totalPages={totalPages}
            opened={pageIndex >= 1}
            frontTexture={coverTexture}
            backTexture={spreads[0].left}
            isLeftPage={false}
            currentSpread={pageIndex}
            visible={true}
        />
    );
    
    // Spread pages
    spreads.forEach((spread, spreadIndex) => {
        const pageNumber = spreadIndex + 1;
        const spreadNumber = spreadIndex + 1;
        const nextSpread = spreads[spreadIndex + 1];
        
        allPages.push(
            <Page
                key={pageNumber}
                number={pageNumber}
                totalPages={totalPages}
                opened={pageIndex > spreadNumber}
                frontTexture={spread.right}
                backTexture={nextSpread ? nextSpread.left : null}
                isLeftPage={false}
                currentSpread={pageIndex}
                visible={true}
            />
        );
    });

    return (
        <group
            ref={groupRef}
            onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
            onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
        >
            {allPages}
        </group>
    );
};

export default function BookDemo({ onBack }: { onBack: () => void }) {
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    const handleNext = () => {
        if (currentPage < totalPages) {
            setCurrentPage(prev => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentPage > 0) {
            setCurrentPage(prev => prev - 1);
        }
    };

    return (
        <div className="w-full h-screen relative overflow-hidden font-sans" style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 50%, #e8f4fc 100%)' }}>
            {/* Decorative background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[30%] -left-[15%] w-[60%] h-[60%] bg-sky-200/40 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
                <div className="absolute top-[50%] -right-[15%] w-[50%] h-[70%] bg-blue-200/30 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
                <div className="absolute -bottom-[20%] left-[20%] w-[40%] h-[40%] bg-indigo-100/30 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
            </div>

            <button
                onClick={onBack}
                className="absolute top-8 left-8 z-50 text-sky-700 hover:text-sky-900 transition-all duration-300 flex items-center gap-2 font-medium bg-white/60 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm hover:shadow-md hover:bg-white/80"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
            </button>

            {/* Page indicator */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-white/80 backdrop-blur-lg px-6 py-3 rounded-full shadow-lg border border-white/50 transition-all duration-300">
                {new Array(totalPages + 1).fill(0).map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        className={`
                            rounded-full transition-all duration-300 
                            ${i === currentPage
                                ? 'w-3 h-3 bg-gradient-to-r from-sky-500 to-blue-600 shadow-md'
                                : 'w-2 h-2 bg-sky-300/70 hover:bg-sky-400 hover:scale-125'
                            }
                        `}
                    />
                ))}
            </div>
            
            {/* Navigation areas */}
            <div 
                className="absolute left-0 top-0 w-1/2 h-full z-40 cursor-pointer group"
                onClick={handlePrev}
            >
                <div className="absolute left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:translate-x-1">
                    <div className="bg-white/90 backdrop-blur-md rounded-full p-3 shadow-xl border border-sky-100">
                        <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                    </div>
                </div>
            </div>
            <div 
                className="absolute right-0 top-0 w-1/2 h-full z-40 cursor-pointer group"
                onClick={handleNext}
            >
                <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:-translate-x-1">
                    <div className="bg-white/90 backdrop-blur-md rounded-full p-3 shadow-xl border border-sky-100">
                        <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>

            <Canvas shadows camera={{ position: [0, 0.5, 8], fov: 35 }}>
                {/* Enhanced lighting for depth and dimension */}
                <ambientLight intensity={0.5} />
                
                {/* Key light - main illumination from top-right */}
                <directionalLight 
                    position={[4, 5, 5]} 
                    intensity={1.0} 
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
                    shadow-camera-far={20}
                    shadow-camera-left={-5}
                    shadow-camera-right={5}
                    shadow-camera-top={5}
                    shadow-camera-bottom={-5}
                    shadow-bias={-0.0001}
                    color="#fff8f0"
                />
                
                {/* Fill light - softer from left */}
                <directionalLight 
                    position={[-3, 2, 3]} 
                    intensity={0.3} 
                    color="#f0f5ff"
                />
                
                {/* Back light for rim/edge definition */}
                <pointLight position={[0, 2, -3]} intensity={0.4} color="#ffeedd" />

                <PresentationControls
                    global
                    rotation={[0.1, 0, 0]}
                    polar={[-Math.PI / 10, Math.PI / 10]}
                    azimuth={[-Math.PI / 6, Math.PI / 6]}
                >
                    <Float
                        rotationIntensity={0.05}
                        floatIntensity={0.1}
                        speed={1.5}
                        floatingRange={[-0.015, 0.015]}
                    >
                        <group position={[0, 0.1, 0]}>
                            <React.Suspense fallback={null}>
                                <Book pageIndex={currentPage} setTotalPages={setTotalPages} setCurrentPage={setCurrentPage} />
                            </React.Suspense>
                        </group>
                    </Float>
                </PresentationControls>

                {/* Environment for realistic reflections */}
                <Environment preset="city" />
                
                {/* Soft fog for atmospheric depth */}
                <fog attach="fog" args={['#e8f4fc', 12, 28]} />
            </Canvas>
        </div>
    );
}
